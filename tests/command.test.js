import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

import command from "../src/services/command.js";
import scaffold from "../src/services/mod-scaffold.js";
import config from "../src/config.js";

/**
 * The command runner is the single place the application invokes an external
 * program. These tests assert the property the security fix depends on: there
 * is no shell, so metacharacters in arguments are inert data.
 */

let workDir;

beforeAll(() => {
	workDir = fs.mkdtempSync(path.join(os.tmpdir(), "civbuilder-cmd-"));
});

afterAll(() => {
	fs.rmSync(workDir, { recursive: true, force: true });
});

describe("command.run", () => {
	it("passes arguments literally, without shell interpretation", async () => {
		const { stdout } = await command.run("/bin/echo", ["hello world"]);
		expect(stdout.trim()).toBe("hello world");
	});

	it("does not expand command substitution in arguments", async () => {
		// Under a shell this would run `id` and echo its output.
		const { stdout } = await command.run("/bin/echo", ["$(id)"]);
		expect(stdout.trim()).toBe("$(id)");
		expect(stdout).not.toMatch(/uid=/);
	});

	it("does not expand backticks in arguments", async () => {
		const { stdout } = await command.run("/bin/echo", ["`id`"]);
		expect(stdout.trim()).toBe("`id`");
		expect(stdout).not.toMatch(/uid=/);
	});

	it("does not treat a semicolon as a command separator", async () => {
		const marker = path.join(workDir, "pwned");
		const { stdout } = await command.run("/bin/echo", [`x; touch ${marker}`]);

		expect(stdout).toContain("x; touch");
		expect(fs.existsSync(marker)).toBe(false);
	});

	it("does not treat a pipe or redirect as shell syntax", async () => {
		const marker = path.join(workDir, "redirected");
		const { stdout } = await command.run("/bin/echo", [`a | tee ${marker}`, `b > ${marker}`]);

		expect(stdout).toContain("|");
		expect(stdout).toContain(">");
		expect(fs.existsSync(marker)).toBe(false);
	});

	it("does not expand globs or environment variables", async () => {
		const { stdout } = await command.run("/bin/echo", ["*", "$HOME"]);
		expect(stdout.trim()).toBe("* $HOME");
	});

	it("rejects non-string arguments rather than coercing them", async () => {
		await expect(command.run("/bin/echo", [42])).rejects.toThrow(/all arguments to be strings/);
		await expect(command.run("/bin/echo", "not-an-array")).rejects.toThrow(/arguments to be strings/);
	});

	it("rejects a missing executable path", async () => {
		await expect(command.run("")).rejects.toThrow(/requires an executable path/);
	});

	it("propagates a non-zero exit status as a rejection", async () => {
		await expect(command.run("/bin/false", [])).rejects.toThrow();
	});

	it("rejects when the executable does not exist", async () => {
		await expect(command.run("/nonexistent/binary", [])).rejects.toThrow(/ENOENT/);
	});
});

describe("mod scaffolding", () => {
	const seed = "scaffoldtest";

	it("creates the data mod tree and packages it", async () => {
		const paths = await scaffold.createModFolder(seed, false);

		expect(fs.existsSync(paths.dataDir)).toBe(true);
		expect(fs.existsSync(path.join(paths.dataDir, "info.json"))).toBe(true);

		const info = JSON.parse(fs.readFileSync(path.join(paths.dataDir, "info.json"), "utf8"));
		expect(info.Title).toContain(seed);

		// A UI mod was not requested, so it must not be created.
		expect(fs.existsSync(paths.uiDir)).toBe(false);

		const archive = await scaffold.zipModFolder(seed, false);
		expect(fs.existsSync(archive)).toBe(true);
		expect(fs.statSync(archive).size).toBeGreaterThan(0);
		// The working tree is removed once packaging succeeds.
		expect(fs.existsSync(paths.root)).toBe(false);
	});

	it("creates the UI mod tree with every locale directory", async () => {
		const uiSeed = "scaffoldui";
		const paths = await scaffold.createModFolder(uiSeed, true);

		expect(fs.existsSync(paths.uiDir)).toBe(true);
		expect(fs.existsSync(paths.moddedStrings)).toBe(true);
		expect(fs.existsSync(paths.civFlags)).toBe(true);

		for (const locale of scaffold.LOCALES) {
			expect(fs.existsSync(path.join(paths.uiResources, locale, "strings", "key-value")), locale).toBe(true);
		}

		fs.rmSync(paths.root, { recursive: true, force: true });
	});

	it("fans the English strings file out to every locale", async () => {
		const uiSeed = "scaffoldlang";
		const paths = await scaffold.createModFolder(uiSeed, true);
		fs.writeFileSync(paths.moddedStrings, "12345 Test String");

		await scaffold.copyLanguages(uiSeed);

		for (const locale of scaffold.LOCALES) {
			const file = path.join(paths.uiResources, locale, "strings", "key-value", "key-value-modded-strings-utf8.txt");
			expect(fs.readFileSync(file, "utf8"), locale).toBe("12345 Test String");
		}

		fs.rmSync(paths.root, { recursive: true, force: true });
	});

	it("refuses to scaffold a mod for an invalid seed", async () => {
		await expect(scaffold.createModFolder("../evil", false)).rejects.toThrow(/Invalid seed/);
	});

	it("ignores voice language IDs that are not integers", async () => {
		const uiSeed = "scaffoldvoice";
		await scaffold.createModFolder(uiSeed, true);

		// Must not throw, and must not attempt a traversal via a crafted ID.
		await scaffold.copyVoices(uiSeed, ["../../etc", null, -5, 1.5]);

		fs.rmSync(path.join(config.dirs.requestedMods, uiSeed), { recursive: true, force: true });
	});
});
