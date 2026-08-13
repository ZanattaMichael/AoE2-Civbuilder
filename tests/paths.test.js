import path from "node:path";
import { describe, it, expect } from "vitest";

import pathsService from "../src/services/paths.js";
import config from "../src/config.js";

const { resolveWithin, draftFile, modRoot, modArchive, modPaths } = pathsService;

/**
 * Path containment is the second line of defence behind identifier validation.
 * These tests assert it holds independently, so a future caller that forgets to
 * validate still cannot reach outside the permitted roots.
 */

describe("resolveWithin", () => {
	it("resolves ordinary segments inside the root", () => {
		const resolved = resolveWithin("/srv/app", "sub", "file.txt");
		expect(resolved).toBe(path.resolve("/srv/app/sub/file.txt"));
	});

	it("allows the root itself", () => {
		expect(resolveWithin("/srv/app", ".")).toBe(path.resolve("/srv/app"));
	});

	it("refuses to escape the root via traversal", () => {
		expect(() => resolveWithin("/srv/app", "..")).toThrow(/escapes its permitted root/);
		expect(() => resolveWithin("/srv/app", "../etc/passwd")).toThrow();
		expect(() => resolveWithin("/srv/app", "a/../../b")).toThrow();
	});

	it("refuses an absolute segment that would replace the root", () => {
		expect(() => resolveWithin("/srv/app", "/etc/passwd")).toThrow(/escapes its permitted root/);
	});

	it("is not fooled by a sibling directory sharing a name prefix", () => {
		expect(() => resolveWithin("/srv/app", "../app-evil/secret")).toThrow();
	});
});

describe("draftFile", () => {
	it("builds a path inside the drafts directory", () => {
		const file = draftFile("123456");
		expect(file).toBe(path.join(config.dirs.drafts, "123456.json"));
	});

	it("rejects traversal attempts before touching the filesystem", () => {
		expect(() => draftFile("../../etc/passwd")).toThrow(/Invalid draftID/);
		expect(() => draftFile("..")).toThrow(/Invalid draftID/);
	});
});

describe("mod paths", () => {
	it("keeps every derived path inside the mod root", () => {
		const paths = modPaths("abc123");
		const root = modRoot("abc123");

		for (const [key, value] of Object.entries(paths)) {
			if (key === "archive") {
				// The archive deliberately lives one level up, beside the root.
				expect(path.dirname(value)).toBe(config.dirs.requestedMods);
				continue;
			}
			expect(value.startsWith(root), `${key} -> ${value}`).toBe(true);
		}
	});

	it("rejects an invalid seed", () => {
		expect(() => modRoot("../evil")).toThrow(/Invalid seed/);
		expect(() => modArchive("a; rm -rf /")).toThrow(/Invalid id/);
	});

	it("names the archive after the seed", () => {
		expect(modArchive("abc123")).toBe(path.join(config.dirs.requestedMods, "abc123.zip"));
	});
});
