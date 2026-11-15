export type BluelayerFailureReason =
	| "offline"
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

export type PanelConnectionState =
	| { status: "idle" | "checking" }
	| { status: "ready"; checkedAt: number; elapsedMs: number }
	| {
			status: "unavailable";
			reason: BluelayerFailureReason;
			checkedAt: number;
			elapsedMs: number;
	  };

export function panelConnectionMessage(reason: BluelayerFailureReason): string {
	const messages: Partial<Record<BluelayerFailureReason, string>> = {
		offline:
			"\u7f51\u7edc\u5c1a\u672a\u5c31\u7eea\uff0c\u8bf7\u68c0\u67e5 Wi-Fi\u3001\u7f51\u7ebf\u6216\u98de\u884c\u6a21\u5f0f\uff0c\u8054\u7f51\u540e\u91cd\u65b0\u68c0\u6d4b\u3002",
		dns: "\u65e0\u6cd5\u89e3\u6790\u767b\u5f55\u670d\u52a1\u5730\u5740\uff0c\u8bf7\u68c0\u67e5\u7f51\u7edc\u6216 DNS \u8bbe\u7f6e\u540e\u91cd\u65b0\u68c0\u6d4b\u3002",
		timeout:
			"\u8fde\u63a5\u767b\u5f55\u670d\u52a1\u8d85\u65f6\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5\u6216\u5207\u6362\u7f51\u7edc\u3002",
		tls: "\u65e0\u6cd5\u4e0e\u767b\u5f55\u670d\u52a1\u5efa\u7acb\u5b89\u5168\u8fde\u63a5\uff0c\u8bf7\u68c0\u67e5\u7cfb\u7edf\u65e5\u671f\u3001\u65f6\u95f4\u6216\u7f51\u7edc\u5b89\u5168\u8f6f\u4ef6\u3002",
		http: "\u767b\u5f55\u670d\u52a1\u6682\u65f6\u4e0d\u53ef\u7528\uff0c\u8bf7\u7a0d\u540e\u91cd\u65b0\u68c0\u6d4b\uff1b\u6301\u7eed\u51fa\u73b0\u65f6\u8bf7\u8054\u7cfb\u5ba2\u670d\u3002",
		invalid_payload:
			"\u767b\u5f55\u670d\u52a1\u8fd4\u56de\u5f02\u5e38\u5185\u5bb9\uff0c\u7f51\u7edc\u53ef\u80fd\u9700\u8981\u7f51\u9875\u8ba4\u8bc1\uff0c\u8bf7\u786e\u8ba4\u540e\u91cd\u65b0\u68c0\u6d4b\u3002",
		connection:
			"\u6682\u65f6\u65e0\u6cd5\u8fde\u901a\u767b\u5f55\u670d\u52a1\uff0c\u8bf7\u68c0\u67e5\u7f51\u7edc\u3001\u5176\u4ed6\u4ee3\u7406\u8f6f\u4ef6\u6216\u9632\u706b\u5899\u540e\u91cd\u65b0\u68c0\u6d4b\u3002",
	};
	return (
		messages[reason] ??
		"\u6682\u65f6\u672a\u80fd\u786e\u8ba4\u767b\u5f55\u670d\u52a1\u53ef\u7528\uff0c\u8bf7\u91cd\u65b0\u68c0\u6d4b\u6216\u8054\u7cfb\u5ba2\u670d\u3002"
	);
}

export function classifyPanelConnectionFailure(
	error: unknown,
	onlineHint = true,
): BluelayerFailureReason {
	const pending = [error];
	const seen = new Set<unknown>();
	const reasons = new Set<BluelayerFailureReason>();
	// Promise.any errors and wrapped causes must not lose their individual reasons.
	while (pending.length && seen.size < 32) {
		const current = pending.shift();
		if (seen.has(current)) continue;
		seen.add(current);
		reasons.add(classifyBluelayerError(current));
		if (current instanceof AggregateError) pending.push(...current.errors);
		if (current instanceof Error && current.cause) pending.push(current.cause);
	}
	// A real HTTP/TLS response is stronger evidence than a WebView offline hint.
	for (const reason of ["http", "invalid_payload", "tls"] as const) {
		if (reasons.has(reason)) return reason;
	}
	if (!onlineHint) return "offline";
	for (const reason of ["dns", "timeout", "connection"] as const) {
		if (reasons.has(reason)) return reason;
	}
	return "unknown";
}

export function createPanelPreflight<T>(
	probe: (refreshConfig: boolean) => Promise<T>,
	{
		publish,
		isOnline = () => true,
	}: {
		publish: (state: PanelConnectionState) => void;
		isOnline?: () => boolean;
	},
) {
	let pending: Promise<T> | null = null;
	function checkPanelConnection(refreshConfig = false): Promise<T> {
		if (pending) return pending;
		const started = performance.now();
		publish({ status: "checking" });
		pending = Promise.resolve()
			.then(() => probe(refreshConfig))
			.then((result) => {
				publish({
					status: "ready",
					checkedAt: Date.now(),
					elapsedMs: Math.round(performance.now() - started),
				});
				return result;
			})
			.catch((error: unknown) => {
				const reason = classifyPanelConnectionFailure(error, isOnline());
				publish({
					status: "unavailable",
					reason,
					checkedAt: Date.now(),
					elapsedMs: Math.round(performance.now() - started),
				});
				throw new BluelayerOperationError(
					panelConnectionMessage(reason),
					reason,
				);
			})
			.finally(() => {
				pending = null;
			});
		return pending;
	}
	return checkPanelConnection;
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
