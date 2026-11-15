const V1_KEY = "RocketMaker";

type V1Payload = { code: number; info: string; data?: any };

function rc4(text: string, key: string) {
	const s = Array.from({ length: 256 }, (_, i) => i);
	let j = 0;
	for (let i = 0; i < 256; i += 1) {
		j = (j + s[i] + key.charCodeAt(i % key.length)) % 256;
		[s[i], s[j]] = [s[j], s[i]];
	}

	let i = 0;
	j = 0;
	let result = "";
	for (let c = 0; c < text.length; c += 1) {
		i = (i + 1) % 256;
		j = (j + s[i]) % 256;
		[s[i], s[j]] = [s[j], s[i]];
		const k = s[(s[i] + s[j]) % 256];
		result += String.fromCharCode(text.charCodeAt(c) ^ k);
	}
	return result;
}

export function parseV1Payload(raw: string): V1Payload {
	const trimmed = raw.trim();

	try {
		const decrypted = rc4(atob(trimmed), V1_KEY);
		// RC4 returns bytes; decode UTF-8 before parsing Chinese messages and user data.
		const bytes = Uint8Array.from(decrypted, (char) => char.charCodeAt(0));
		const json = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
		return JSON.parse(json) as V1Payload;
	} catch {
		try {
			return JSON.parse(trimmed) as V1Payload;
		} catch {
			throw new Error(
				"\u670d\u52a1\u5668\u8fd4\u56de\u7684\u6570\u636e\u683c\u5f0f\u5f02\u5e38\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5\u3002",
			);
		}
	}
}
