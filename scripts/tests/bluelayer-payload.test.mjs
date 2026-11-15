import assert from "node:assert/strict";
import { test } from "node:test";

import { parseV1Payload } from "../../src/utils/bluelayer-payload.ts";

// Fixed Base64/RC4 fixtures containing UTF-8 JSON, as returned by the panel API.
const chineseError =
	"x5qHtfBGxZs4tO7XKcRyytdpKQvRmZHvW7PZjwFw/1QCXtAJZgU9CkPbyRe7ybbFezTBpx5Q6w==";
const chineseUser =
	"x5qHtfBGxZs+tO7XKcRyytdpKQt3UB0k12Zec/a3aqnHiyKFgPK0yInb3xc5HUlM9ptIRtraHuH7L/Aw+RZVeV01VwaGexO8QP9ZRwgef2yu9/M2XCUgkRCij60RXAqSLP9rOpGOoCanh0a3w9dCQsTV9EBi";
const escapedError =
	"x5qHtfBGxZs4tO7XKcRyytdpKQtkbgg+wmBjcqLzZee5i2TZwa2J0NSd1wD9hODAOHrO8EhS4zq1fg==";

test("encrypted Chinese login errors decode as UTF-8", () => {
	assert.deepEqual(parseV1Payload(chineseError), {
		code: 400,
		info: "\u90ae\u7bb1\u6216\u5bc6\u7801\u9519\u8bef",
		data: null,
	});
});

test("encrypted user data preserves Chinese, emoji and numeric traffic", () => {
	assert.deepEqual(parseV1Payload(chineseUser), {
		code: 200,
		info: "OK",
		data: {
			username: "\u6d4b\u8bd5\u7528\u6237",
			label: "HK \ud83c\udded\ud83c\uddf0",
			traffic: { total: 1024, used: 256 },
		},
	});
});

test("encrypted JSON with Unicode escapes remains supported", () => {
	assert.equal(parseV1Payload(escapedError).info, "\u767b\u5f55\u5931\u8d25");
});

test("plain JSON responses preserve Chinese messages", () => {
	const payload = { code: 400, info: "\u767b\u5f55\u5931\u8d25", data: null };
	assert.deepEqual(parseV1Payload(JSON.stringify(payload)), payload);
});

test("whitespace around encrypted responses is accepted", () => {
	assert.deepEqual(
		parseV1Payload(`\r\n ${chineseError}\r\n`),
		parseV1Payload(chineseError),
	);
});

test("unwrapped update responses remain supported", () => {
	const update = { version: "1.0.6", content: "\u66f4\u65b0\u8bf4\u660e" };
	assert.deepEqual(parseV1Payload(JSON.stringify(update)), update);
});

test("invalid responses display a readable message without response contents", () => {
	for (const raw of ["", "not-base64", "<html>upstream failed</html>"]) {
		assert.throws(() => parseV1Payload(raw), {
			message:
				"\u670d\u52a1\u5668\u8fd4\u56de\u7684\u6570\u636e\u683c\u5f0f\u5f02\u5e38\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5\u3002",
		});
	}
});
