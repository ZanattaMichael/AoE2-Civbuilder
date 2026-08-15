"use strict";

const fs = require("fs");
const crypto = require("crypto");

const config = require("../config");
const logger = require("../logger");
const { draftFile } = require("./paths");
const { isValidDraftId } = require("../validation");

/**
 * Draft persistence.
 *
 * All reads and writes of draft state funnel through here so that path
 * construction, JSON parsing and seat authorization exist in exactly one place.
 */

function ensureDraftsDir() {
	fs.mkdirSync(config.dirs.drafts, { recursive: true });
}

function exists(draftId) {
	if (!isValidDraftId(draftId)) {
		return false;
	}
	try {
		return fs.existsSync(draftFile(draftId));
	} catch {
		return false;
	}
}

/** Reads a draft, returning null when it is absent or unreadable. */
function read(draftId) {
	if (!isValidDraftId(draftId)) {
		return null;
	}
	let file;
	try {
		file = draftFile(draftId);
	} catch {
		return null;
	}
	if (!fs.existsSync(file)) {
		return null;
	}
	try {
		return JSON.parse(fs.readFileSync(file, "utf8"));
	} catch (err) {
		logger.error(`Draft ${draftId} is corrupt: ${err.message}`);
		return null;
	}
}

/** Writes a draft atomically so a crash mid-write cannot truncate it. */
function write(draft) {
	const draftId = draft && draft.id;
	if (!isValidDraftId(draftId)) {
		throw new Error("Cannot persist a draft without a valid id");
	}
	ensureDraftsDir();
	const file = draftFile(draftId);
	const temp = `${file}.${process.pid}.tmp`;
	fs.writeFileSync(temp, JSON.stringify(draft, null, 2));
	fs.renameSync(temp, file);
	return draft;
}

/** Generates a draft ID that is not already in use. */
function generateId() {
	ensureDraftsDir();
	for (let attempt = 0; attempt < 100; attempt++) {
		let id = "";
		for (let i = 0; i < 15; i++) {
			id += crypto.randomInt(10).toString();
		}
		if (!exists(id)) {
			return id;
		}
	}
	throw new Error("Unable to allocate a unique draft ID");
}

/**
 * Issues an unguessable token for a seat. The token — not a client-supplied
 * player number — is what proves a caller may act as that player.
 */
function issueSeatToken() {
	return crypto.randomBytes(32).toString("hex");
}

function timingSafeEqual(a, b) {
	if (typeof a !== "string" || typeof b !== "string") {
		return false;
	}
	const bufA = Buffer.from(a);
	const bufB = Buffer.from(b);
	if (bufA.length !== bufB.length) {
		return false;
	}
	return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Resolves a seat token to the player number it owns.
 * @returns {number} the player index, or -1 for a spectator / unrecognised token
 */
function resolveSeat(draft, token) {
	if (!draft || !token || !Array.isArray(draft.players)) {
		return -1;
	}
	for (let i = 0; i < draft.players.length; i++) {
		if (timingSafeEqual(draft.players[i].token || "", token)) {
			return i;
		}
	}
	return -1;
}

/**
 * Strips server-only fields before a draft is sent to clients. Seat tokens must
 * never leave the server, or every player would be able to impersonate the rest.
 */
function toPublic(draft) {
	if (!draft) {
		return draft;
	}
	const clone = JSON.parse(JSON.stringify(draft));
	if (Array.isArray(clone.players)) {
		for (const player of clone.players) {
			delete player.token;
		}
	}
	return clone;
}

module.exports = {
	ensureDraftsDir,
	exists,
	read,
	write,
	generateId,
	issueSeatToken,
	resolveSeat,
	toPublic,
};
