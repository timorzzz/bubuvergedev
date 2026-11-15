import assert from "node:assert/strict";
import { test } from "node:test";

import {
	BluelayerOperationError,
	classifyBluelayerError,
	summarizeProxyReadiness,
	waitForProxyReadiness,
} from "../../src/utils/bluelayer-diagnostics.ts";

const empty = {
	proxies: {
		DIRECT: { type: "Direct" },
		GLOBAL: { type: "Selector", all: ["DIRECT"] },
	},
};
const loaded = {
	proxies: {
		...empty.proxies,
		Route: { type: "Selector", all: ["node"] },
		node: { type: "Shadowsocks" },
	},
};

test("a responding core with only built-in targets is not ready", () => {
	assert.deepEqual(summarizeProxyReadiness(empty.proxies), {
		groupCount: 1,
		nodeCount: 0,
	});
});

test("inline subscription nodes are counted without exposing names", () => {
	assert.deepEqual(summarizeProxyReadiness(loaded.proxies), {
		groupCount: 2,
		nodeCount: 1,
	});
});

test("provider-backed targets do not need the auxiliary provider API", () => {
	const proxies = {
		Route: { type: "Selector", all: ["provider-node", "DIRECT"] },
		DIRECT: { type: "Direct" },
	};
	assert.deepEqual(summarizeProxyReadiness(proxies), {
		groupCount: 1,
		nodeCount: 1,
	});
});

test("empty selectors and custom-named direct/reject targets are not nodes", () => {
	const proxies = {
		Route: { type: "Selector", all: ["custom-direct", "custom-reject"] },
		"custom-direct": { type: "Direct" },
		"custom-reject": { type: "Reject" },
	};
	assert.equal(summarizeProxyReadiness(proxies).nodeCount, 0);
});

test("the first readiness check happens immediately", async () => {
	const result = await waitForProxyReadiness(async () => loaded);
	assert.equal(result.ready, true);
	assert.equal(result.attempts, 1);
});

test("loading can continue beyond the old four-query limit", async () => {
	let attempts = 0;
	const result = await waitForProxyReadiness(
		async () => (++attempts > 4 ? loaded : empty),
		{ timeoutMs: 2000, intervalMs: 1 },
	);
	assert.equal(result.ready, true);
	assert.equal(result.attempts, 5);
});

test("transient IPC failure can recover without restarting profile import", async () => {
	let attempts = 0;
	const result = await waitForProxyReadiness(
		async () => {
			if (++attempts === 1) throw new Error("IPC pipe unavailable");
			return loaded;
		},
		{ timeoutMs: 2000, intervalMs: 1 },
	);
	assert.equal(result.ready, true);
	assert.equal(result.attempts, 2);
});

test("empty runtime and failed IPC are reported as distinct failures", async () => {
	const options = { timeoutMs: 30, intervalMs: 1 };
	const noNodes = await waitForProxyReadiness(async () => empty, options);
	const failedIpc = await waitForProxyReadiness(async () => {
		throw new Error("IPC pipe unavailable");
	}, options);
	assert.equal(noNodes.reason, "empty_proxies");
	assert.equal(failedIpc.reason, "ipc");
	assert.equal(noNodes.ready, false);
	assert.equal(failedIpc.ready, false);
});

test("a hung core query times out and cannot block login forever", async () => {
	const result = await waitForProxyReadiness(() => new Promise(() => {}), {
		timeoutMs: 35,
		requestTimeoutMs: 10,
		intervalMs: 1,
	});
	assert.equal(result.ready, false);
	assert.equal(result.reason, "timeout");
});

test("diagnostic reasons never contain raw URLs, emails or cookies", () => {
	const raw =
		"IPC socket failed https://private.example/sub/token?password=secret user@example.com Cookie=session-secret";
	assert.equal(classifyBluelayerError(new Error(raw)), "ipc");
	assert.equal(classifyBluelayerError(raw), "ipc");
	assert.equal(classifyBluelayerError({ password: "secret" }), "unknown");
});

test("activation failures keep their fixed diagnostic reason", () => {
	assert.equal(
		classifyBluelayerError(
			new BluelayerOperationError("private details", "activation_rejected"),
		),
		"activation_rejected",
	);
});

test("native decoding errors are not collapsed into unknown failures", () => {
	for (const error of [
		"error decoding response body",
		"missing field `uot` at line 1 column 45",
		"unknown variant `FutureProtocol`",
		{ message: "error deserializing response body" },
		"core_snapshot:invalid_shape",
	])
		assert.equal(classifyBluelayerError(error), "invalid_payload");
});

test("command permission failures have their own safe category", () => {
	assert.equal(
		classifyBluelayerError("plugin command not allowed by permissions"),
		"permission_denied",
	);
});

test("a short final probe does not replace a persistent decode failure with timeout", async () => {
	const result = await waitForProxyReadiness(
		async () => {
			throw "error decoding response body";
		},
		{ timeoutMs: 55, requestTimeoutMs: 1000, intervalMs: 1 },
	);
	assert.equal(result.ready, false);
	assert.equal(result.reason, "invalid_payload");
});

test("standard request errors are categorized without including their text", () => {
	for (const [message, reason] of [
		["request timed out", "timeout"],
		["dns lookup failed", "dns"],
		["TLS certificate invalid", "tls"],
		["connection refused", "connection"],
		["HTTP 403", "http"],
	]) {
		assert.equal(classifyBluelayerError(new Error(message)), reason);
	}
});
