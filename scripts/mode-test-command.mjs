const supportedTargets = new Set([
	"x86_64-pc-windows-msvc",
	"x86_64-unknown-linux-gnu",
	"x86_64-apple-darwin",
	"aarch64-apple-darwin",
]);

export function modeTestCargoArgs(target, { realCore = false } = {}) {
	if (!supportedTargets.has(target)) {
		throw new Error("A supported package target is required for mode tests");
	}
	// build.rs resolves sidecar resources using Cargo's target, not the runner host.
	return [
		"test",
		"--locked",
		"--target",
		target,
		"-p",
		"bluelayer",
		"--no-default-features",
		"--lib",
		realCore
			? "feat::clash_mode::tests::real_core_routes_traffic_and_recovers_without_resetting_user_data"
			: "feat::clash_mode::tests",
		...(realCore ? ["--", "--ignored", "--exact"] : []),
	];
}
