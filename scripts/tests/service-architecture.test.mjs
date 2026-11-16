import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import yaml from "js-yaml";

import {
	readRustHostTarget,
	resolveBuildTargetArgument,
} from "../build-target.mjs";
import {
	SERVICE_BINARIES,
	verifyMacosServiceBinaries,
} from "../check-service-architecture.mjs";

const intel = "x86_64-apple-darwin";
const arm = "aarch64-apple-darwin";

test("implicit pnpm prebuild retains Intel package target on an ARM runner", () => {
	const explicit = resolveBuildTargetArgument([intel]);
	const implicit = resolveBuildTargetArgument([], {
		BLUELAYER_BUILD_TARGET: explicit,
	});
	assert.equal(explicit, intel);
	assert.equal(implicit, intel);
	assert.notEqual(implicit, arm);
});

test("force flags and explicit target forms retain the requested architecture", () => {
	for (const args of [
		[intel],
		["--force", intel],
		[intel, "-f"],
		["--target", intel],
		[`--target=${intel}`],
	]) {
		assert.equal(resolveBuildTargetArgument(args), intel);
	}
});

test("package target is inherited for every currently shipped platform", () => {
	for (const target of [
		intel,
		arm,
		"x86_64-pc-windows-msvc",
		"x86_64-unknown-linux-gnu",
	]) {
		assert.equal(
			resolveBuildTargetArgument([], { BLUELAYER_BUILD_TARGET: target }),
			target,
		);
		assert.equal(
			resolveBuildTargetArgument([], { TAURI_ENV_TARGET_TRIPLE: target }),
			target,
		);
	}
});

test("conflicting package and Tauri targets fail instead of silently mixing resources", () => {
	assert.throws(
		() => resolveBuildTargetArgument([arm], { BLUELAYER_BUILD_TARGET: intel }),
		/does not match/,
	);
	assert.throws(
		() =>
			resolveBuildTargetArgument([], {
				BLUELAYER_BUILD_TARGET: intel,
				TAURI_ENV_TARGET_TRIPLE: arm,
			}),
		/does not match/,
	);
	assert.throws(() => resolveBuildTargetArgument([intel, arm]), /Conflicting/);
	assert.throws(
		() => resolveBuildTargetArgument(["--target"]),
		/valid build target/,
	);
});

test("native development and standard Cargo target fallback remain available", () => {
	assert.equal(resolveBuildTargetArgument([], {}), undefined);
	assert.equal(
		resolveBuildTargetArgument([], { CARGO_BUILD_TARGET: intel }),
		intel,
	);
	assert.equal(
		resolveBuildTargetArgument([intel], { CARGO_BUILD_TARGET: arm }),
		intel,
	);
	assert.equal(
		readRustHostTarget(
			() => `rustc 1.91.0\r\nhost: ${arm}\r\nrelease: 1.91.0\r\n`,
		),
		arm,
	);
	assert.throws(
		() => readRustHostTarget(() => "no host field"),
		/Unable to determine/,
	);
});

test("all three Intel service resources must contain an x86_64 slice", () => {
	const checked = [];
	assert.equal(
		verifyMacosServiceBinaries(intel, "resources with spaces", (file) => {
			checked.push(path.basename(file));
			return ["x86_64"];
		}),
		3,
	);
	assert.deepEqual(checked, SERVICE_BINARIES);
});

test("ARM installer in an Intel bundle is rejected even if the daemon is correct", () => {
	assert.throws(
		() =>
			verifyMacosServiceBinaries(intel, "resources", (file) =>
				path.basename(file) === "bluelayer-mihomo-service-install"
					? ["arm64"]
					: ["x86_64"],
			),
		/Wrong service architecture: bluelayer-mihomo-service-install/,
	);
});

test("missing or unreadable service helper cannot pass the bundle check", () => {
	assert.throws(
		() =>
			verifyMacosServiceBinaries(intel, "resources", () => {
				throw new Error("missing file");
			}),
		/Cannot verify/,
	);
});

test("Apple Silicon and universal service binaries are checked without regression", () => {
	assert.equal(
		verifyMacosServiceBinaries(arm, "resources", () => ["arm64"]),
		3,
	);
	for (const target of [arm, intel])
		assert.equal(
			verifyMacosServiceBinaries(target, "resources", () => [
				"arm64",
				"x86_64",
			]),
			3,
		);
	assert.throws(
		() => verifyMacosServiceBinaries(arm, "resources", () => ["x86_64"]),
		/Wrong service architecture/,
	);
});

test("Windows and Linux do not invoke macOS tools or change their resource layout", () => {
	for (const target of ["x86_64-pc-windows-msvc", "x86_64-unknown-linux-gnu"]) {
		assert.equal(
			verifyMacosServiceBinaries(target, "resources", () => {
				throw new Error("must not inspect");
			}),
			0,
		);
		const output = execFileSync(
			process.execPath,
			[
				fileURLToPath(
					new URL("../check-service-architecture.mjs", import.meta.url),
				),
				"--target",
				target,
			],
			{
				encoding: "utf8",
				env: {
					...process.env,
					PATH: "",
					BLUELAYER_BUILD_TARGET: target,
					TAURI_ENV_TARGET_TRIPLE: target,
				},
			},
		);
		assert.match(output, /checked=0/);
	}
});

test("Auto Build and Release jobs bind prebuild to the package matrix target", () => {
	for (const workflow of ["autobuild", "release"]) {
		const config = yaml.load(
			readFileSync(
				new URL(`../../.github/workflows/${workflow}.yml`, import.meta.url),
				"utf8",
			),
		);
		let builds = 0;
		for (const job of Object.values(config.jobs)) {
			if (
				!(job.steps || []).some((step) =>
					step.uses?.startsWith("tauri-apps/tauri-action"),
				)
			)
				continue;
			builds += 1;
			assert.equal(job.env.BLUELAYER_BUILD_TARGET, "${{ matrix.target }}");
			assert(
				job.steps.some(
					(step) =>
						step.run ===
						"cargo test --locked -p clash_verge_service_ipc --features standalone --lib --bin bluelayer-mihomo-service-install",
				),
			);
		}
		assert.equal(builds, 2);
	}
});

test("bundle hook validates resources again after lifecycle scripts have finished", () => {
	const config = JSON.parse(
		readFileSync(
			new URL("../../src-tauri/tauri.conf.json", import.meta.url),
			"utf8",
		),
	);
	assert.equal(
		config.build.beforeBundleCommand,
		"node scripts/check-service-architecture.mjs",
	);
	const schema = JSON.parse(
		readFileSync(
			new URL(
				"../../node_modules/@tauri-apps/cli/config.schema.json",
				import.meta.url,
			),
			"utf8",
		),
	);
	assert("beforeBundleCommand" in schema.definitions.BuildConfig.properties);
});
