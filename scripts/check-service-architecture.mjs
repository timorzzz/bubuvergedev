import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
	readRustHostTarget,
	resolveBuildTargetArgument,
} from "./build-target.mjs";

export const SERVICE_BINARIES = [
	"bluelayer-mihomo-service",
	"bluelayer-mihomo-service-install",
	"bluelayer-mihomo-service-uninstall",
];

function inspectArchitectures(file) {
	return execFileSync("lipo", ["-archs", file], { encoding: "utf8" })
		.trim()
		.split(/\s+/);
}

export function verifyMacosServiceBinaries(
	target,
	directory,
	inspect = inspectArchitectures,
) {
	if (!target.endsWith("-apple-darwin")) return 0;
	const expected = {
		"x86_64-apple-darwin": "x86_64",
		"aarch64-apple-darwin": "arm64",
	}[target];
	if (!expected) throw new Error(`Unsupported macOS service target: ${target}`);
	for (const binary of SERVICE_BINARIES) {
		let architectures;
		try {
			architectures = inspect(path.join(directory, binary));
		} catch (cause) {
			throw new Error(
				`Cannot verify ${binary} for ${target}; rebuild service resources for this target`,
				{ cause },
			);
		}
		if (!architectures.includes(expected)) {
			throw new Error(
				`Wrong service architecture: ${binary}; expected ${expected} for ${target}, found ${architectures.join(", ")}`,
			);
		}
	}
	return SERVICE_BINARIES.length;
}

if (
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	const target =
		resolveBuildTargetArgument(process.argv.slice(2), process.env) ||
		readRustHostTarget();
	const root = fileURLToPath(new URL("../", import.meta.url));
	const checked = verifyMacosServiceBinaries(
		target,
		path.join(root, "src-tauri", "resources"),
	);
	console.log(
		`Service architecture check: target=${target}, checked=${checked}`,
	);
}
