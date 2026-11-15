export type BluelayerFailureReason =
	| "timeout"
	| "dns"
	| "tls"
	| "connection"
	| "ipc"
	| "invalid_payload"
	| "http"
	| "permission_denied"
	| "activation_rejected"
	| "profile_missing"
	| "empty_proxies"
	| "auth_rejected"
	| "unknown";

export class BluelayerOperationError extends Error {
	readonly reason: BluelayerFailureReason;
	constructor(message: string, reason: BluelayerFailureReason) {
		super(message);
		this.reason = reason;
	}
}

// Only return fixed categories. Raw errors may contain credentials and private URLs.
export function classifyBluelayerError(error: unknown): BluelayerFailureReason {
	if (error instanceof BluelayerOperationError) return error.reason;
	if (error instanceof SyntaxError) return "invalid_payload";
	const message =
		error instanceof Error
			? error.message
			: typeof error === "string"
				? error
				: error &&
						typeof error === "object" &&
						"message" in error &&
						typeof error.message === "string"
					? error.message
					: "";
	if (
		/denied|not allowed|forbidden.*command|not found.*command|command.*not found/i.test(
			message,
		)
	)
		return "permission_denied";
	if (
		/decod|deserial|invalid_payload|invalid_shape|missing field|unknown variant|parse error/i.test(
			message,
		)
	)
		return "invalid_payload";
	if (/timeout|timed out|\u8d85\u65f6/i.test(message)) return "timeout";
	if (/dns|resolve|lookup|getaddrinfo/i.test(message)) return "dns";
	if (/certificate|tls|ssl/i.test(message)) return "tls";
	if (/pipe|socket|ipc|plugin.*mihomo/i.test(message)) return "ipc";
	if (/connect|network|econn|\u8fde\u63a5/i.test(message)) return "connection";
	if (/HTTP\s*\d{3}|core_snapshot:http/i.test(message)) return "http";
	return "unknown";
}

type ProxyRecord = Record<
	string,
	{ type?: string; all?: string[] } | undefined
>;
type ProxyResponse = { proxies: ProxyRecord };
type ReadinessResult = {
	attempts: number;
	elapsedMs: number;
	groupCount: number;
	nodeCount: number;
} & ({ ready: true } | { ready: false; reason: BluelayerFailureReason });
const builtInNames = new Set([
	"DIRECT",
	"REJECT",
	"REJECT-DROP",
	"PASS",
	"COMPATIBLE",
	"GLOBAL",
]);
const builtInTypes = new Set([
	"direct",
	"reject",
	"rejectdrop",
	"pass",
	"compatible",
	"dns",
]);

export function summarizeProxyReadiness(proxies: ProxyRecord) {
	let groupCount = 0;
	const nodes = new Set<string>();
	for (const [name, proxy] of Object.entries(proxies)) {
		if (!proxy) continue;
		if (Array.isArray(proxy.all)) {
			groupCount += 1;
			for (const target of proxy.all) {
				const resolved = proxies[target];
				// Provider-backed nodes may have group targets without a top-level record.
				if (
					!builtInNames.has(target) &&
					!Array.isArray(resolved?.all) &&
					!builtInTypes.has(resolved?.type?.toLowerCase() ?? "")
				)
					nodes.add(target);
			}
		} else if (
			!builtInNames.has(name) &&
			!builtInTypes.has(proxy.type?.toLowerCase() ?? "")
		) {
			nodes.add(name);
		}
	}
	return { groupCount, nodeCount: nodes.size };
}

export async function waitForProxyReadiness(
	readProxies: () => Promise<ProxyResponse>,
	{ timeoutMs = 15_000, requestTimeoutMs = 2_000, intervalMs = 500 } = {},
): Promise<ReadinessResult> {
	const started = performance.now();
	let attempts = 0;
	let counts = { groupCount: 0, nodeCount: 0 };
	let reason: BluelayerFailureReason = "empty_proxies";
	while (performance.now() - started < timeoutMs) {
		// Do not overwrite the useful failure with a new query that has no time left.
		if (
			attempts > 0 &&
			timeoutMs - (performance.now() - started) < Math.min(50, requestTimeoutMs)
		)
			break;
		attempts += 1;
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			const remaining = Math.max(1, timeoutMs - (performance.now() - started));
			const response = await Promise.race([
				readProxies(),
				new Promise<never>((_, reject) => {
					timer = setTimeout(
						() => reject(new Error("core query timeout")),
						Math.min(requestTimeoutMs, remaining),
					);
				}),
			]);
			counts = summarizeProxyReadiness(response.proxies);
			if (counts.nodeCount > 0)
				return {
					ready: true,
					attempts,
					elapsedMs: Math.round(performance.now() - started),
					...counts,
				};
			reason = "empty_proxies";
		} catch (error) {
			reason = classifyBluelayerError(error);
		} finally {
			clearTimeout(timer);
		}
		const remaining = timeoutMs - (performance.now() - started);
		if (remaining > 0)
			await new Promise((resolve) =>
				setTimeout(resolve, Math.min(intervalMs, remaining)),
			);
	}
	return {
		ready: false,
		attempts,
		elapsedMs: Math.round(performance.now() - started),
		reason,
		...counts,
	};
}
