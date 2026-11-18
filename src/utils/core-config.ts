import type { BaseConfig } from "tauri-plugin-mihomo-api";

const camelKey = (key: string) =>
	key.replace(/-([a-z0-9])/g, (_, letter: string) => letter.toUpperCase());

const camelFields = (value: Record<string, unknown>) =>
	Object.fromEntries(
		Object.entries(value).map(([key, item]) => [camelKey(key), item]),
	);

export function normalizeCoreConfig(value: unknown): BaseConfig {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("core_snapshot:invalid_shape");
	}
	const raw = value as Record<string, unknown>;
	if (!["rule", "global", "direct"].includes(String(raw.mode))) {
		throw new Error("core_snapshot:invalid_shape");
	}
	const result = camelFields(raw);
	// Only schema fields are transformed. User-defined map keys remain untouched.
	for (const key of ["tun", "tuicServer", "geoxUrl"]) {
		const section = result[key];
		if (section && typeof section === "object" && !Array.isArray(section)) {
			result[key] = camelFields(section as Record<string, unknown>);
		}
	}
	return result as unknown as BaseConfig;
}
