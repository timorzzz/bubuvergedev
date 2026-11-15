import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const target = process.argv[2];
const supportedTargets = new Set([
	"x86_64-pc-windows-msvc",
	"aarch64-apple-darwin",
	"x86_64-apple-darwin",
	"x86_64-unknown-linux-gnu",
]);
assert(supportedTargets.has(target), "A supported package target is required");
const windows = process.platform === "win32";
const binary = join(
	root,
	"src-tauri",
	"sidecar",
	`bluelayer-mihomo-${target}${windows ? ".exe" : ""}`,
);
await access(binary);
const directory = await mkdtemp(join(tmpdir(), "bl-core-"));
const socket = windows
	? `\\\\.\\pipe\\bl-core-smoke-${process.pid}`
	: join(directory, "m.sock");
const core = spawn(
	binary,
	[
		"-d",
		directory,
		"-f",
		join(root, "scripts", "tests", "fixtures", "mihomo-ipc-smoke.yaml"),
		windows ? "-ext-ctl-pipe" : "-ext-ctl-unix",
		socket,
	],
	{ cwd: root, windowsHide: true, stdio: "ignore" },
);
let coreFailed = false;
const coreClosed = new Promise((done) => {
	core.once("error", () => {
		coreFailed = true;
		done();
	});
	core.once("close", () => {
		done();
	});
});

try {
	const status = await new Promise((done, reject) => {
		const cargo = spawn(
			"cargo",
			[
				"test",
				"--locked",
				"-p",
				"bluelayer-core-snapshot",
				"--lib",
				"native_tests::reads_real_mihomo_snapshot",
				"--",
				"--ignored",
				"--exact",
			],
			{
				cwd: root,
				windowsHide: true,
				stdio: "inherit",
				env: { ...process.env, BLUELAYER_SMOKE_SOCKET: socket },
			},
		);
		const timer = setTimeout(() => {
			cargo.kill();
		}, 180_000);
		cargo.once("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
		cargo.once("close", (code) => {
			clearTimeout(timer);
			done(code);
		});
	});
	assert(!coreFailed && status === 0, "Real core IPC smoke test failed");
	console.log(`Real core IPC smoke test passed for ${target}`);
} finally {
	if (core.exitCode === null && core.signalCode === null) core.kill();
	await coreClosed;
	// Remove only the fresh, owned test directory, never a computed user directory.
	assert.equal(dirname(directory), resolve(tmpdir()));
	assert(basename(directory).startsWith("bl-core-"));
	await rm(directory, { recursive: true, force: true });
}
