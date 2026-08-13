"use strict";

const drafts = require("../services/drafts");
const { isValidDraftId } = require("../validation");

/**
 * Draft seat authentication.
 *
 * The previous implementation read an unsigned `playerNumber` cookie and took
 * it at face value, so any client could claim any seat in any draft simply by
 * setting a cookie. Seats are now proved by an unguessable signed token issued
 * when the player joins; the player number is derived from that token
 * server-side and never accepted from the client.
 */

const SEAT_COOKIE = "seatToken";
const DRAFT_COOKIE = "draftID";

/** Reads the signed seat token for a draft, if the client presents a valid one. */
function readSeatToken(req) {
	const signed = req.signedCookies || {};
	return typeof signed[SEAT_COOKIE] === "string" ? signed[SEAT_COOKIE] : null;
}

function setSeatCookie(res, draftId, token) {
	const options = {
		httpOnly: true,
		signed: true,
		sameSite: "lax",
		secure: process.env.NODE_ENV === "production",
		maxAge: 24 * 60 * 60 * 1000,
	};
	res.cookie(SEAT_COOKIE, token, options);
	res.cookie(DRAFT_COOKIE, draftId, { ...options, httpOnly: false });
}

/**
 * Resolves the requester's relationship to the draft named by `:id`.
 *
 * Populates req.draft, req.draftId and req.playerNumber (-1 for spectators).
 */
function loadDraft(req, res, next) {
	const draftId = req.params.id || req.body.draftID;

	if (!isValidDraftId(draftId)) {
		req.draft = null;
		req.draftId = null;
		req.playerNumber = -1;
		return next();
	}

	req.draftId = draftId;
	req.draft = drafts.read(draftId);
	req.playerNumber = -1;

	if (req.draft) {
		// Tokens are compared against the seats of this draft only, so a token
		// issued for a different draft resolves to -1 (spectator).
		const token = readSeatToken(req);
		if (token) {
			req.playerNumber = drafts.resolveSeat(req.draft, token);
		}
	}

	return next();
}

/** Rejects the request when the draft named by `:id` does not exist. */
function requireDraft(req, res, next) {
	if (!req.draft) {
		return res.status(404).render("error", { error: "Draft does not exist" });
	}
	return next();
}

module.exports = {
	SEAT_COOKIE,
	DRAFT_COOKIE,
	readSeatToken,
	setSeatCookie,
	loadDraft,
	requireDraft,
};
