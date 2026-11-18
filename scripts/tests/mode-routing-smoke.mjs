import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const target = process.argv[2];
assert(
	new Set([
		"x86_64-pc-windows-msvc",
		"aarch64-apple-darwin",
		"x86_64-apple-darwin",
		"x86_64-unknown-linux-gnu",
	]).has(target),
);
const windows = process.platform === "win32";
const binary = join(
	root,
	"src-tauri",
	"sidecar",
	`bluelayer-mihomo-${target}${windows ? ".exe" : ""}`,
);
await access(binary);
const directory = await mkdtemp(join(tmpdir(), "bl-route-"));
const socket = windows
	? `\\\\.\\pipe\\bl-route-${process.pid}`
	: join(directory, "m.sock");
const sockets = new Set();
const track = (connection) => {
	sockets.add(connection);
	connection.on("error", () => {});
	connection.on("close", () => sockets.delete(connection));
};
const direct = http.createServer((_, response) => response.end("DIRECT"));
direct.on("connection", track);
const socks = net.createServer((connection) => {
	track(connection);
	let state = "greeting";
	let buffer = Buffer.alloc(0);
	connection.on("data", (chunk) => {
		buffer = Buffer.concat([buffer, chunk]);
		if (state === "greeting") {
			if (buffer.length < 2 || buffer.length < 2 + buffer[1]) return;
			assert.equal(buffer[0], 5);
			buffer = buffer.subarray(2 + buffer[1]);
			connection.write(Buffer.from([5, 0]));
			state = "request";
		}
		if (state === "request") {
			if (buffer.length < 5) return;
			const length =
				buffer[3] === 1 ? 10 : buffer[3] === 4 ? 22 : 7 + buffer[4];
			if (buffer.length < length) return;
			assert.equal(buffer[1], 1);
			buffer = buffer.subarray(length);
			connection.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]));
			state = "http";
		}
		if (state === "http" && buffer.includes("\r\n\r\n")) {
			state = "done";
			connection.end(
				"HTTP/1.1 200 OK\r\nContent-Length: 7\r\nConnection: close\r\n\r\nPROXIED",
			);
		}
	});
});
const listen = (server) =>
	new Promise((done, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => done(server.address().port));
	});
const ipc = (path) =>
	new Promise((done, reject) => {
		const request = http.get(
			{ socketPath: socket, path, agent: false },
			(response) => {
				let body = "";
				response.on("data", (data) => {
					body += data;
				});
				response.on("end", () => {
					try {
						done(JSON.parse(body));
					} catch (error) {
						reject(error);
					}
				});
			},
		);
		request.setTimeout(1000, () => request.destroy(new Error("IPC timeout")));
		request.on("error", reject);
	});
let core;
let coreClosed;
const stopCore = async () => {
	if (core && core.exitCode === null && core.signalCode === null) core.kill();
	await coreClosed;
};
try {
	const directPort = await listen(direct);
	const socksPort = await listen(socks);
	const reservation = net.createServer();
	const mixedPort = await listen(reservation);
	await new Promise((done) => reservation.close(done));
	for (const restart of [false, true]) {
		// Generated synthetic config only; never load or modify the user's profile.
		const config = join(directory, "fixture.yaml");
		await writeFile(
			config,
			`mixed-port: ${mixedPort}\nbind-address: 127.0.0.1\nmode: ${restart ? "global" : "rule"}\nlog-level: warning\nipv6: false\ndns: {enable: false}\nprofile: {store-selected: true}\nproxies:\n  - {name: test-node, type: socks5, server: 127.0.0.1, port: ${socksPort}}\nproxy-groups:\n  - {name: test-group, type: select, proxies: [test-node, DIRECT]}\nrules: ["MATCH,test-group"]\n`,
		);
		core = spawn(
			binary,
			[
				"-d",
				directory,
				"-f",
				config,
				windows ? "-ext-ctl-pipe" : "-ext-ctl-unix",
				socket,
			],
			{ cwd: root, windowsHide: true, stdio: "ignore" },
		);
		coreClosed = new Promise((done) => core.once("close", done));
		core.on("error", () => {});
		let ready = false;
		for (let attempt = 0; attempt < 200; attempt++) {
			try {
				const value = await ipc("/proxies");
				if (value.proxies?.["test-group"]?.now === "test-node") {
					ready = true;
					break;
				}
			} catch {
				/* Startup may not have bound the controller yet. */
			}
			if (core.exitCode !== null) break;
			await sleep(100);
		}
		assert(ready, "Isolated routing fixture was not ready");
		const code = await new Promise((done, reject) => {
			const cargo = spawn(
				"cargo",
				[
					"test",
					"--locked",
					"-p",
					"bluelayer",
					"--no-default-features",
					"--lib",
					"feat::clash_mode::tests::real_core_routes_traffic_and_recovers_without_resetting_user_data",
					"--",
					"--ignored",
					"--exact",
				],
				{
					cwd: root,
					windowsHide: true,
					stdio: "inherit",
					env: {
						...process.env,
						BLUELAYER_SMOKE_SOCKET: socket,
						BLUELAYER_SMOKE_PROXY: `http://127.0.0.1:${mixedPort}`,
						BLUELAYER_SMOKE_DESTINATION: `http://127.0.0.1:${directPort}/`,
						...(restart ? { BLUELAYER_SMOKE_RESTART: "1" } : {}),
					},
				},
			);
			const timer = setTimeout(() => cargo.kill(), 300_000);
			cargo.once("error", (error) => {
				clearTimeout(timer);
				reject(error);
			});
			cargo.once("close", (status) => {
				clearTimeout(timer);
				done(status);
			});
		});
		assert.equal(
			code,
			0,
			`Real mode/traffic smoke failed (restart=${restart})`,
		);
		await sleep(1100); // Allow the core's selected-choice cache to flush before restart.
		await stopCore();
	}
	console.log(`Real mode, traffic and restart smoke passed for ${target}`);
} finally {
	await stopCore();
	for (const connection of sockets) connection.destroy();
	await Promise.all(
		[direct, socks].map((server) => new Promise((done) => server.close(done))),
	);
	assert.equal(dirname(directory), resolve(tmpdir()));
	assert(basename(directory).startsWith("bl-route-"));
	await rm(directory, { recursive: true, force: true });
}
