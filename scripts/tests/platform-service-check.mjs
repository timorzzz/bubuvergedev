import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const target = process.argv[2];
assert(
	new Set([
		"x86_64-pc-windows-msvc",
		"x86_64-unknown-linux-gnu",
		"x86_64-apple-darwin",
		"aarch64-apple-darwin",
	]).has(target),
	"A supported package target is required",
);

// Compile actual application functions with real dependencies, without the UI SDK.
function extractFunction(source, name) {
	const signature = source.indexOf(`fn ${name}(`);
	assert(signature >= 0, `Missing application function: ${name}`);
	let start = source.lastIndexOf("\n", signature) + 1;
	const preceding = source.lastIndexOf("\n", start - 2) + 1;
	if (source.slice(preceding, start).trim().startsWith("#[cfg("))
		start = preceding;
	const body = source.indexOf("{", signature);
	let depth = 0;
	for (const token of source
		.slice(body)
		.matchAll(/"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\/|[{}]/g)) {
		if (token[0] === "{") depth++;
		if (token[0] === "}" && --depth === 0)
			return source.slice(start, body + token.index + 1);
	}
	throw new Error(`Unclosed application function: ${name}`);
}

const service = await readFile(
	join(root, "src-tauri/src/core/service.rs"),
	"utf8",
);
const config = await readFile(
	join(root, "src-tauri/src/config/config.rs"),
	"utf8",
);
const lock = await readFile(join(root, "Cargo.lock"), "utf8");
const directory = await mkdtemp(join(tmpdir(), "bl-platform-check-"));
try {
	const dependencies = [
		"anyhow",
		"tokio",
		"log",
		"once_cell",
		"regex",
		"serde_yaml_ng",
	].map((name) => {
		const version = lock.match(
			new RegExp(`name = "${name}"\\r?\\nversion = "([^"]+)"`),
		)?.[1];
		assert(version, `Missing locked dependency: ${name}`);
		const features =
			name === "tokio"
				? ', features = ["rt", "time", "process", "fs", "io-util", "macros"]'
				: "";
		return `${name} = { version = "=${version}"${features} }`;
	});
	for (const [name, folder, features] of [
		[
			"clash_verge_service_ipc",
			"clash-verge-service-ipc",
			', features = ["client"]',
		],
		["clash-verge-logging", "clash-verge-logging", ""],
	]) {
		dependencies.push(
			`${name} = { path = ${JSON.stringify(join(root, "crates", folder))}${features} }`,
		);
	}
	await writeFile(
		join(directory, "Cargo.toml"),
		[
			'[package]\nname = "bluelayer-platform-boundary-check"\nversion = "0.0.0"\nedition = "2024"',
			'[lib]\npath = "check.rs"',
			"[workspace]",
			"[dependencies]",
			...dependencies,
		].join("\n"),
	);
	await writeFile(join(directory, "Cargo.lock"), lock);
	const rust = [
		"#![deny(warnings)]",
		"use anyhow::{Context as _, Result};",
		"#[cfg(unix)] use std::path::Path;",
		"use std::time::Duration;",
		"use serde_yaml_ng::Mapping;",
		'#[cfg(not(target_os = "linux"))] use clash_verge_logging::{logging, Type};',
		extractFunction(service, "is_service_available"),
		extractFunction(config, "remove_config_key"),
		extractFunction(config, "sanitize_platform_inbounds"),
		"pub fn check_inbound_types(config: &mut Mapping) { sanitize_platform_inbounds(config); }",
		`#[path = ${JSON.stringify(join(root, "src-tauri/src/core/service_diagnostics.rs"))}] mod service_diagnostics;`,
		'pub async fn check_diagnostic_types() { service_diagnostics::log_failure("compile_check", &anyhow::anyhow!("compile check only")).await; }',
	].join("\n");
	await writeFile(join(directory, "check.rs"), rust);
	const args = [
		"check",
		"--manifest-path",
		join(directory, "Cargo.toml"),
		"--lib",
		"--target",
		target,
		"--target-dir",
		join(root, "target"),
	];
	if (process.argv.includes("--offline")) args.push("--offline");
	const result = spawnSync("cargo", args, {
		cwd: root,
		stdio: "inherit",
		windowsHide: true,
		timeout: 180_000,
	});
	if (result.error) throw result.error;
	assert.equal(
		result.status,
		0,
		`Application platform boundary check failed: ${target}`,
	);
	console.log(
		`Application IPC, diagnostics and inbound types checked for ${target}; no service operations executed.`,
	);
	if (process.argv.includes("--verify-regression")) {
		assert(
			target !== "x86_64-pc-windows-msvc",
			"The historical regression is Unix-only",
		);
		const broken = rust.replace(
			"Path::new(clash_verge_service_ipc::IPC_PATH).metadata()?",
			"Path::metadata(clash_verge_service_ipc::IPC_PATH)?",
		);
		assert.notEqual(
			broken,
			rust,
			"The regression fixture must alter the checked function",
		);
		await writeFile(join(directory, "check.rs"), broken);
		const rejected = spawnSync("cargo", args, {
			cwd: root,
			encoding: "utf8",
			windowsHide: true,
			timeout: 180_000,
		});
		if (rejected.error) throw rejected.error;
		assert.notEqual(
			rejected.status,
			0,
			"The old invalid Path call must fail compilation",
		);
		assert.match(rejected.stderr, /error\[E0308\]/);
		console.log(
			`Historical Unix Path type regression rejected with E0308 for ${target}.`,
		);
	}
} finally {
	assert.equal(dirname(directory), resolve(tmpdir()));
	assert(basename(directory).startsWith("bl-platform-check-"));
	await rm(directory, { recursive: true, force: true });
}
