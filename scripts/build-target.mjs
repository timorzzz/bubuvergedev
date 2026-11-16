import { execFileSync } from "node:child_process";

export function resolveBuildTargetArgument(args, env = {}) {
	let explicit;
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--force" || arg === "-f") continue;
		const value =
			arg === "--target" || arg === "-t"
				? args[++index]
				: arg.startsWith("--target=")
					? arg.slice(9)
					: arg;
		if (!value || value.startsWith("-"))
			throw new Error("A valid build target is required");
		if (explicit && explicit !== value)
			throw new Error("Conflicting build target arguments");
		explicit = value;
	}
	const configured = env.BLUELAYER_BUILD_TARGET || env.TAURI_ENV_TARGET_TRIPLE;
	if (
		env.BLUELAYER_BUILD_TARGET &&
		env.TAURI_ENV_TARGET_TRIPLE &&
		env.BLUELAYER_BUILD_TARGET !== env.TAURI_ENV_TARGET_TRIPLE
	) {
		throw new Error(
			"Bluelayer build target does not match the Tauri package target",
		);
	}
	if (explicit && configured && explicit !== configured) {
		throw new Error(
			"Build target argument does not match the configured package target",
		);
	}
	return explicit || configured || env.CARGO_BUILD_TARGET;
}

export function readRustHostTarget(run = execFileSync) {
	const output = run("rustc", ["-vV"], { encoding: "utf8" });
	const target = /^host:\s*(\S+)\s*$/m.exec(output)?.[1];
	if (!target) throw new Error("Unable to determine the Rust host target");
	return target;
}
