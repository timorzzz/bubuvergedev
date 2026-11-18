import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

import yaml from "js-yaml";
import ts from "typescript";

import { normalizeCoreConfig } from "../../src/utils/core-config.ts";
import { modeTestCargoArgs } from "../mode-test-command.mjs";

test("real smoke command retains Intel target on an ARM runner before accessing resources", () => {
	const args = JSON.parse(
		execFileSync(
			process.execPath,
			[
				fileURLToPath(new URL("./mode-routing-smoke.mjs", import.meta.url)),
				"x86_64-apple-darwin",
				"--print-cargo-args",
			],
			{
				encoding: "utf8",
				env: { ...process.env, CARGO_BUILD_TARGET: "aarch64-apple-darwin" },
			},
		),
	);
	assert.deepEqual(
		args,
		modeTestCargoArgs("x86_64-apple-darwin", { realCore: true }),
	);
	assert.equal(args[args.indexOf("--target") + 1], "x86_64-apple-darwin");
});

test("mode tests compile for the package architecture, never implicitly for the runner", () => {
	for (const target of [
		"x86_64-pc-windows-msvc",
		"x86_64-unknown-linux-gnu",
		"x86_64-apple-darwin",
		"aarch64-apple-darwin",
	]) {
		for (const realCore of [false, true]) {
			const args = modeTestCargoArgs(target, { realCore });
			assert.equal(args[args.indexOf("--target") + 1], target);
			assert.equal(args.filter((arg) => arg === "--target").length, 1);
			assert(args.includes("--no-default-features"));
			assert.equal(args.includes("--ignored"), realCore);
		}
	}
	for (const target of [undefined, "", "unsupported"]) {
		assert.throws(() => modeTestCargoArgs(target), /supported package target/);
	}
	const intelArgs = modeTestCargoArgs("x86_64-apple-darwin", {
		realCore: true,
	});
	const cargoTarget = (args, host) =>
		args.includes("--target") ? args[args.indexOf("--target") + 1] : host;
	assert.equal(
		cargoTarget(["test", "--no-default-features"], "aarch64-apple-darwin"),
		"aarch64-apple-darwin",
	);
	assert.equal(
		cargoTarget(intelArgs, "aarch64-apple-darwin"),
		"x86_64-apple-darwin",
	);
});

test("all Auto Build mode test steps bind Cargo to their prepared package resources", () => {
	const workflow = yaml.load(
		readFileSync(
			new URL("../../.github/workflows/autobuild.yml", import.meta.url),
			"utf8",
		),
	);
	const expectedCommand = `cargo ${modeTestCargoArgs("x86_64-apple-darwin")
		.map((arg) =>
			arg === "x86_64-apple-darwin" ? "${{ matrix.target }}" : arg,
		)
		.join(" ")}`;
	let count = 0;
	for (const job of Object.values(workflow.jobs)) {
		const step = job.steps?.find(
			(item) =>
				item.name === "Test proxy mode feedback and real traffic recovery",
		);
		if (!step) continue;
		count++;
		assert.equal(job.env.BLUELAYER_BUILD_TARGET, "${{ matrix.target }}");
		assert(step.run.includes(expectedCommand));
	}
	assert.equal(count, 2);
});

test("core mode remains readable without optional plugin metadata", () => {
	for (const mode of ["rule", "global", "direct"]) {
		const value = normalizeCoreConfig({
			mode,
			"mixed-port": 17897,
			tun: { enable: false, stack: "future-stack", "auto-route": true },
			"tuic-server": { users: { "user-name": "value" } },
		});
		assert.equal(value.mode, mode);
		assert.equal(value.mixedPort, 17897);
		assert.equal(value.tun.autoRoute, true);
		assert.equal(value.tun.stack, "future-stack");
		assert.deepEqual(value.tuicServer.users, { "user-name": "value" });
	}
	for (const invalid of [null, [], {}, { mode: "bad" }]) {
		assert.throws(() => normalizeCoreConfig(invalid), /invalid_shape/);
	}
});

const commandsCode = ts.transpileModule(
	readFileSync(new URL("../../src/services/cmds.ts", import.meta.url), "utf8"),
	{
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			target: ts.ScriptTarget.ES2022,
		},
	},
).outputText;

function createModeCommand(invoke) {
	const cache = [];
	const exports = {};
	runInNewContext(commandsCode, {
		exports,
		require: (name) => {
			if (name === "@tauri-apps/api/core") return { invoke };
			if (name === "@/utils/core-config") return { normalizeCoreConfig };
			if (name === "@/services/query-client")
				return {
					queryClient: {
						cancelQueries: async () => {},
						setQueryData: (key, value) => cache.push([key, value]),
					},
				};
			if (
				["dayjs", "@/services/notice-service", "@/utils/debug"].includes(name)
			)
				return {};
			throw new Error(`Unexpected command import ${name}`);
		},
	});
	return { patch: exports.patchClashMode, cache };
}

test("all mode callers share the core-confirmed cache update", async () => {
	let complete;
	const calls = [];
	const command = createModeCommand((name, arguments_) => {
		calls.push([name, arguments_]);
		return new Promise((done) => {
			complete = done;
		});
	});
	const pending = command.patch("global", "test-node");
	assert.equal(command.cache.length, 0);
	complete({ mode: "global", "mixed-port": 17897 });
	assert.equal((await pending).mode, "global");
	assert.equal(command.cache[0][0][0], "getClashConfig");
	assert.equal(command.cache[0][1].mode, "global");
	assert.equal(calls[0][1].preferredProxy, "test-node");
});

test("failed mode commands do not falsely highlight the requested mode", async () => {
	const command = createModeCommand(async () => {
		throw new Error("mock mode failure");
	});
	await assert.rejects(command.patch("global"), /mock mode failure/);
	assert.equal(command.cache.length, 0);
});

const code = ts.transpileModule(
	readFileSync(
		new URL("../../src/hooks/use-proxy-selection.ts", import.meta.url),
		"utf8",
	),
	{
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			target: ts.ScriptTarget.ES2022,
		},
	},
).outputText;

const reactStub = {
	useCallback: function callbackStub(fn) {
		return fn;
	},
	useMemo: function memoStub(fn) {
		return fn();
	},
	useRef: function refStub(current) {
		return { current };
	},
};
const vergeStub = () => ({ verge: {} });

function createHook(select, confirms = true) {
	const profiles = {
		current: "fixture",
		items: [
			{
				uid: "fixture",
				selected: [{ name: "other-group", now: "other-node" }],
			},
		],
	};
	const errors = [];
	const saved = [];
	const proxies = {};
	let successes = 0;
	const exports = {};
	runInNewContext(code, {
		exports,
		console: { error() {}, warn() {} },
		setTimeout,
		require: (name) => {
			if (name === "react") return reactStub;
			if (name === "tauri-plugin-mihomo-api")
				return {
					selectNodeForGroup: async (group, node) => {
						await select(group, node);
						if (confirms) proxies[group] = { now: node };
					},
				};
			if (name === "@/hooks/use-verge") return { useVerge: vergeStub };
			if (name === "@/utils/debug") return { debugLog() {} };
			if (name === "@/services/cmds")
				return {
					getProfiles: async () => profiles,
					getMihomoProxies: async () => ({ proxies }),
					patchProfile: async (_, patch) => {
						profiles.items[0].selected = patch.selected;
						saved.push(patch);
					},
					syncTrayProxySelection: async () => {},
				};
			throw new Error(`Unexpected import ${name}`);
		},
	});
	return {
		...exports.useProxySelection({
			onError: (error) => errors.push(error),
			onSuccess: () => successes++,
		}),
		profiles,
		errors,
		saved,
		successes: () => successes,
	};
}

test("node selection awaits the core and merges fresh group choices including GLOBAL", async () => {
	let complete;
	const hook = createHook(
		() =>
			new Promise((done) => {
				complete = done;
			}),
	);
	const selection = hook.changeProxy("GLOBAL", "node-a");
	assert.equal(hook.successes(), 0);
	assert.equal(hook.saved.length, 0);
	complete();
	assert.equal(await selection, true);
	assert.equal(hook.successes(), 1);
	assert.equal(
		hook.profiles.items[0].selected.find((item) => item.name === "other-group")
			.now,
		"other-node",
	);
	assert.equal(
		hook.profiles.items[0].selected.find((item) => item.name === "GLOBAL").now,
		"node-a",
	);
});

test("failed selection is not reported or persisted as a success", async () => {
	const hook = createHook(async () => {
		throw new Error("mock core rejected selection");
	});
	assert.equal(await hook.changeProxy("GLOBAL", "node-a"), false);
	assert.equal(hook.successes(), 0);
	assert.equal(hook.saved.length, 0);
	assert.equal(hook.errors.length, 1);
});

test("an accepted request without the actual selected node is a failure", async () => {
	const hook = createHook(async () => {}, false);
	assert.equal(await hook.changeProxy("GLOBAL", "node-a"), false);
	assert.equal(hook.successes(), 0);
	assert.equal(hook.saved.length, 0);
});

test("superseded queued requests settle and the final selection is preserved", async () => {
	const calls = [];
	const complete = [];
	const hook = createHook((group, node) => {
		calls.push([group, node]);
		return new Promise((done) => complete.push(done));
	});
	const first = hook.changeProxy("rules", "node-a");
	const superseded = hook.changeProxy("rules", "node-b");
	const last = hook.changeProxy("rules", "node-c");
	assert.equal(await superseded, false);
	complete[0]();
	assert.equal(await first, true);
	// The queue starts the final request before settling the first caller.
	assert.equal(calls.at(-1)[1], "node-c");
	complete[1]();
	assert.equal(await last, true);
	assert.deepEqual(calls, [
		["rules", "node-a"],
		["rules", "node-c"],
	]);
	assert.equal(
		hook.profiles.items[0].selected.find((item) => item.name === "rules").now,
		"node-c",
	);
});
