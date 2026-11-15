import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

import ts from "typescript";

import * as diagnostics from "../../src/utils/bluelayer-diagnostics.ts";
import { parseV1Payload } from "../../src/utils/bluelayer-payload.ts";

const {
	BluelayerOperationError,
	classifyPanelConnectionFailure,
	createPanelPreflight,
	panelConnectionMessage,
} = diagnostics;

test("panel failures retain individual DNS/TLS/HTTP reasons through Promise.any", () => {
	for (const [error, expected] of [
		[
			new AggregateError(["bluelayer_http:dns", "bluelayer_http:timeout"]),
			"dns",
		],
		[
			new Error("wrapped", {
				cause: new AggregateError(["bluelayer_http:tls"]),
			}),
			"tls",
		],
		[
			new AggregateError([
				new BluelayerOperationError("private response", "http"),
				"bluelayer_http:connection",
			]),
			"http",
		],
	])
		assert.equal(classifyPanelConnectionFailure(error), expected);
});

test("offline hints cannot override a real HTTP or TLS response", () => {
	assert.equal(
		classifyPanelConnectionFailure("bluelayer_http:connection", false),
		"offline",
	);
	assert.equal(
		classifyPanelConnectionFailure("bluelayer_http:tls", false),
		"tls",
	);
	assert.equal(
		classifyPanelConnectionFailure(
			new BluelayerOperationError("service", "http"),
			false,
		),
		"http",
	);
});

test("successful real probes win over WebView offline hints and concurrent checks are shared", async () => {
	const states = [];
	let calls = 0;
	const check = createPanelPreflight(
		async () => {
			calls += 1;
			return "panel";
		},
		{
			publish: (state) => states.push(state),
			isOnline: () => false,
		},
	);
	const first = check();
	assert.equal(check(), first);
	assert.equal(await first, "panel");
	assert.equal(calls, 1);
	assert.equal(states.at(-1).status, "ready");
});

test("failed preflight can recover without restart and never echoes private errors", async () => {
	const states = [];
	let fail = true;
	const check = createPanelPreflight(
		async () => {
			if (fail)
				throw new Error(
					"dns lookup failed https://private.example/?token=secret",
				);
			return "panel";
		},
		{ publish: (state) => states.push(state) },
	);
	await assert.rejects(
		check(),
		(error) =>
			error.reason === "dns" && !/private|secret|https/.test(error.message),
	);
	assert.equal(states.at(-1).status, "unavailable");
	fail = false;
	assert.equal(await check(true), "panel");
	assert.equal(states.at(-1).status, "ready");
	assert.notEqual(
		panelConnectionMessage("dns"),
		panelConnectionMessage("timeout"),
	);
});

// Execute the actual service with in-memory storage and a fake native HTTP boundary.
// No real account, network request, user config or system proxy is accessed.
const serviceCode = ts.transpileModule(
	readFileSync(
		new URL("../../src/services/bluelayer.ts", import.meta.url),
		"utf8",
	),
	{
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			target: ts.ScriptTarget.ES2022,
		},
	},
).outputText;
const panel = "https://panel.example.test";
const cache = (value) => JSON.stringify({ value, savedAt: Date.now() });
const ok = (payload) => ({
	status: 200,
	headers: [],
	text: JSON.stringify(payload),
});
const reactStub = { useSyncExternalStore: () => {} };

function loadService(http, entries = []) {
	const storage = new Map(entries);
	const records = [];
	const requests = [];
	const commands = {
		bluelayerHttpText: (request) => {
			requests.push(request);
			return http(request);
		},
		writeBluelayerDiagnostic: async (record) => {
			records.push(record);
		},
		getProfiles: async () => ({ items: [] }),
		patchVergeConfig: async () => {},
	};
	const modules = {
		react: reactStub,
		"@/services/cmds": commands,
		"@/services/query-client": {
			queryClient: { invalidateQueries: async () => {} },
		},
		"@/utils/bluelayer-diagnostics": diagnostics,
		"@/utils/bluelayer-payload": { parseV1Payload },
		"@root/package.json": { version: "1.0.6" },
	};
	const module = { exports: {} };
	runInNewContext(serviceCode, {
		module,
		exports: module.exports,
		require: (name) => {
			assert(name in modules, `Unexpected service dependency: ${name}`);
			return modules[name];
		},
		localStorage: {
			getItem: (key) => storage.get(key) ?? null,
			setItem: (key, value) => storage.set(key, value),
			removeItem: (key) => storage.delete(key),
		},
		navigator: { onLine: true },
		Error,
		SyntaxError,
		AggregateError,
		Promise,
		JSON,
		Date,
		Headers,
		URL,
		URLSearchParams,
		performance,
		setTimeout,
		clearTimeout,
		console,
	});
	return { service: module.exports, storage, records, requests };
}

test("preflight probes real service even when both panel and UI caches exist", async () => {
	const { service, requests } = loadService(async () => {
		throw "bluelayer_http:dns";
	}, [
		["bluelayer_login_config_cache_v1", cache({ panels: [panel] })],
		["bluelayer_panel_cache_v1", cache({ baseUrl: panel, panelIndex: 0 })],
		[
			"bluelayer_full_config_cache_v1",
			cache({ [panel]: { login: { bgDesc: "cached" } } }),
		],
	]);
	await service.bootstrapBluelayer();
	assert.equal(service.getBluelayerState().ready, true);
	assert.equal(requests.length, 0);
	await assert.rejects(
		service.checkBluelayerNetwork(),
		(error) => error.reason === "dns",
	);
	assert.equal(requests.length, 1);
	assert.equal(new URL(requests[0].url).pathname, "/v1/config");
	assert.equal(service.getBluelayerState().connection.status, "unavailable");
});

test("offline discovery fallback is not cached and recovery finds the configured panel", async () => {
	let online = false;
	const { service, storage, records } = loadService(async ({ url }) => {
		if (!online) throw "bluelayer_http:connection";
		return url.endsWith("login.json")
			? ok({ panels: [panel] })
			: ok({ login: {} });
	});
	await assert.rejects(service.checkBluelayerNetwork());
	assert.equal(storage.has("bluelayer_login_config_cache_v1"), false);
	online = true;
	const result = await service.checkBluelayerNetwork(true);
	assert.equal(result.baseUrl, panel);
	assert.equal(service.getBluelayerState().connection.status, "ready");
	assert(
		records.some(
			(record) => record.stage === "network_check" && record.event === "ready",
		),
	);
	assert(!JSON.stringify(records).includes(panel));
});

test("one healthy panel is sufficient and login reuses the successful preflight", async () => {
	let probes = 0;
	const { service } = loadService(
		async ({ url }) => {
			if (url.includes("unavailable.example")) throw "bluelayer_http:timeout";
			if (url.endsWith("/v1/config")) {
				probes += 1;
				return ok({ login: {} });
			}
			if (url.endsWith("/v1/login"))
				return ok({ code: 200, data: { class: 0 } });
			throw new Error("Unexpected request");
		},
		[
			[
				"bluelayer_login_config_cache_v1",
				cache({ panels: ["https://unavailable.example", panel] }),
			],
		],
	);
	await service.checkBluelayerNetwork();
	await service.loginBluelayer("user@example.test", "not-a-real-password");
	assert.equal(probes, 1);
	assert.equal(service.getBluelayerState().authenticated, true);
});

test("account rejection stays distinct from a network failure", async () => {
	const { service } = loadService(
		async ({ url }) => {
			if (url.endsWith("/v1/config")) return ok({ login: {} });
			return {
				status: 401,
				headers: [],
				text: JSON.stringify({ info: "Account password rejected" }),
			};
		},
		[["bluelayer_login_config_cache_v1", cache({ panels: [panel] })]],
	);
	await service.checkBluelayerNetwork();
	await assert.rejects(
		service.loginBluelayer("user@example.test", "not-a-real-password"),
		(error) =>
			error.reason === "auth_rejected" &&
			error.message === "Account password rejected",
	);
	assert.equal(service.getBluelayerState().connection.status, "ready");
});

test("network lost between preflight and login is shown as connectivity failure", async () => {
	const { service } = loadService(
		async ({ url }) => {
			if (url.endsWith("/v1/config")) return ok({ login: {} });
			throw "bluelayer_http:tls";
		},
		[["bluelayer_login_config_cache_v1", cache({ panels: [panel] })]],
	);
	await service.checkBluelayerNetwork();
	await assert.rejects(
		service.loginBluelayer("user@example.test", "not-a-real-password"),
		(error) => error.reason === "tls",
	);
	assert.equal(service.getBluelayerState().connection.reason, "tls");
});

test("JSON from an unrelated portal is not treated as a healthy login service", async () => {
	const { service } = loadService(
		async () => ok({ captivePortal: true }),
		[["bluelayer_login_config_cache_v1", cache({ panels: [panel] })]],
	);
	await assert.rejects(
		service.checkBluelayerNetwork(),
		(error) => error.reason === "invalid_payload",
	);
});

test("optional empty UI configuration remains supported", async () => {
	for (const configuration of [{}, { login: null, nav: null }]) {
		const { service } = loadService(
			async () => ok(configuration),
			[["bluelayer_login_config_cache_v1", cache({ panels: [panel] })]],
		);
		await service.checkBluelayerNetwork();
		assert.equal(service.getBluelayerState().connection.status, "ready");
	}
});

test("empty authentication failure receives an actionable message", async () => {
	const { service } = loadService(
		async ({ url }) =>
			url.endsWith("/v1/config")
				? ok({ login: {} })
				: ok({ code: 500, info: "" }),
		[["bluelayer_login_config_cache_v1", cache({ panels: [panel] })]],
	);
	await assert.rejects(
		service.loginBluelayer("user@example.test", "not-a-real-password"),
		(error) =>
			error.reason === "auth_rejected" &&
			error.message.length > 20 &&
			!error.message.includes("500"),
	);
});

test("manual recheck refreshes an unreachable cached panel address list", async () => {
	const { service } = loadService(
		async ({ url }) => {
			if (url.endsWith("login.json")) return ok({ panels: [panel] });
			if (url.startsWith(panel)) return ok({ login: {} });
			throw "bluelayer_http:dns";
		},
		[
			[
				"bluelayer_login_config_cache_v1",
				cache({ panels: ["https://old.example.test"] }),
			],
		],
	);
	await assert.rejects(service.checkBluelayerNetwork());
	assert.equal((await service.checkBluelayerNetwork(true)).baseUrl, panel);
});

test("login waits for an in-flight startup check instead of launching a duplicate", async () => {
	let finishProbe;
	let probes = 0;
	const { service } = loadService(
		async ({ url }) => {
			if (url.endsWith("/v1/config")) {
				probes += 1;
				return new Promise((done) => {
					finishProbe = done;
				});
			}
			return ok({ code: 200, data: { class: 0 } });
		},
		[["bluelayer_login_config_cache_v1", cache({ panels: [panel] })]],
	);
	const checking = service.checkBluelayerNetwork();
	const login = service.loginBluelayer(
		"user@example.test",
		"not-a-real-password",
	);
	await new Promise((done) => setImmediate(done));
	assert.equal(probes, 1);
	finishProbe(ok({ login: {} }));
	await Promise.all([checking, login]);
	assert.equal(service.getBluelayerState().authenticated, true);
});
