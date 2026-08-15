"use strict";

const { BadRequestError } = require("./errors");

/**
 * Identifier validation.
 *
 * Mod seeds and draft IDs are used to build filesystem paths and, historically,
 * were interpolated straight into shell command strings. They are now confined
 * to an alphanumeric alphabet, which makes them inert as both shell metacharacter
 * carriers and path traversal sequences. This is enforced at the edge so no
 * downstream consumer has to remember to do it.
 */
const SEED_PATTERN = /^[A-Za-z0-9]{1,32}$/;
const DRAFT_ID_PATTERN = /^[0-9]{1,32}$/;

function isValidSeed(value) {
	return typeof value === "string" && SEED_PATTERN.test(value);
}

function isValidDraftId(value) {
	return typeof value === "string" && DRAFT_ID_PATTERN.test(value);
}

function assertSeed(value, field = "seed") {
	if (!isValidSeed(value)) {
		throw new BadRequestError(`Invalid ${field}: expected 1-32 alphanumeric characters`);
	}
	return value;
}

function assertDraftId(value, field = "draftID") {
	if (!isValidDraftId(value)) {
		throw new BadRequestError(`Invalid ${field}: expected 1-32 digits`);
	}
	return value;
}

/** Parses a JSON string from a request body, converting failures into a 400. */
function parseJsonField(value, field) {
	if (typeof value !== "string") {
		throw new BadRequestError(`Missing or malformed ${field}`);
	}
	try {
		return JSON.parse(value);
	} catch (err) {
		throw new BadRequestError(`Malformed ${field}: not valid JSON`, { cause: err });
	}
}

function assertInteger(value, field, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
	const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
	if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
		throw new BadRequestError(`Invalid ${field}: expected an integer between ${min} and ${max}`);
	}
	return parsed;
}

function assertArray(value, field, { maxLength = Number.MAX_SAFE_INTEGER } = {}) {
	if (!Array.isArray(value)) {
		throw new BadRequestError(`Invalid ${field}: expected an array`);
	}
	if (value.length > maxLength) {
		throw new BadRequestError(`Invalid ${field}: exceeds maximum length of ${maxLength}`);
	}
	return value;
}

/**
 * Player-supplied display text. Stripped of control characters and truncated so
 * it cannot be used to smuggle terminal escapes or bloat the draft file.
 */
function sanitizeText(value, { maxLength = 200, fallback = "" } = {}) {
	if (typeof value !== "string") {
		return fallback;
	}
	// Deliberately strips control characters, including NUL and DEL.
	return value.replace(/[\u0000-\u001F\u007F]/g, "").slice(0, maxLength);
}

/** Booleans arrive from urlencoded form bodies as the strings "true"/"false". */
function parseBoolean(value, fallback = false) {
	if (typeof value === "boolean") {
		return value;
	}
	if (value === "true") {
		return true;
	}
	if (value === "false") {
		return false;
	}
	return fallback;
}

/**
 * Normalises the `modifiers` blob into a known shape with clamped numeric
 * ranges, so a hostile client cannot push absurd values into the native
 * .dat rewriting stage.
 */
function normalizeModifiers(raw) {
	const source = raw && typeof raw === "object" ? raw : {};
	const clamp = (value, min, max, fallback) => {
		const num = typeof value === "number" ? value : Number.parseFloat(value);
		if (!Number.isFinite(num)) {
			return fallback;
		}
		return Math.min(Math.max(num, min), max);
	};

	return {
		randomCosts: parseBoolean(source.randomCosts, false),
		hp: clamp(source.hp, 0.01, 100, 1),
		speed: clamp(source.speed, 0.01, 100, 1),
		blind: parseBoolean(source.blind, false),
		infinity: parseBoolean(source.infinity, false),
		building: clamp(source.building, 0.01, 100, 1),
	};
}

module.exports = {
	SEED_PATTERN,
	DRAFT_ID_PATTERN,
	isValidSeed,
	isValidDraftId,
	assertSeed,
	assertDraftId,
	parseJsonField,
	assertInteger,
	assertArray,
	sanitizeText,
	parseBoolean,
	normalizeModifiers,
};
