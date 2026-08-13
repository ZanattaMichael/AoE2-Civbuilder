"use strict";

const express = require("express");

const config = require("../config");
const { asyncHandler, BadRequestError } = require("../errors");
const { assertInteger } = require("../validation");
const draftsStore = require("../services/drafts");
const draftLogic = require("../services/draft-logic");
const { loadDraft, requireDraft, setSeatCookie } = require("../middleware/auth");
const { sanitizeText } = require("../validation");

const router = express.Router();

const MAX_PLAYERS = 8;
const MAX_ROUNDS = 20;

/** Creates a draft lobby and returns the three invite links. */
router.post(
	"/draft",
	asyncHandler(async (req, res) => {
		const slots = assertInteger(req.body.num_players, "num_players", { min: 1, max: MAX_PLAYERS });
		const points = assertInteger(req.body.techtree_currency, "techtree_currency", { min: 0, max: 100000 });
		const rounds = assertInteger(req.body.rounds, "rounds", { min: 1, max: MAX_ROUNDS });

		if (typeof req.body.allowed_rarities !== "string") {
			throw new BadRequestError("Missing allowed_rarities");
		}
		const rarities = req.body.allowed_rarities.split(",").map((value) => value.trim() === "true");
		if (!rarities.some(Boolean)) {
			throw new BadRequestError("At least one rarity must be allowed");
		}

		const id = draftsStore.generateId();
		const draft = draftLogic.createDraft({ id, slots, points, rounds, rarities });
		draftsStore.write(draft);

		res.render("draft_links", {
			playerlink: `${config.publicUrl}/draft/player/${id}`,
			hostlink: `${config.publicUrl}/draft/host/${id}`,
			spectatorlink: `${config.publicUrl}/draft/${id}`,
		});
	})
);

/**
 * Claims a seat in a draft.
 *
 * On success the player receives a signed, httpOnly seat token. That token —
 * not a client-asserted player number — is what authorizes their later actions.
 */
router.post(
	"/join",
	loadDraft,
	requireDraft,
	asyncHandler(async (req, res) => {
		const draft = req.draft;

		// Already seated in this draft: re-entering after a disconnect.
		if (req.playerNumber >= 0) {
			return res.redirect(`${config.basePath}/draft/${req.draftId}`);
		}

		const civName = sanitizeText(req.body.civ_name, { maxLength: 64 });
		if (!civName) {
			throw new BadRequestError("A player name is required");
		}

		const joinAsHost = String(req.body.joinType) === "0";
		let seat = -1;

		if (joinAsHost) {
			if (draft.players[0].name !== "") {
				return res.status(409).render("error", { error: "Host already joined" });
			}
			seat = 0;
		} else {
			for (let i = 1; i < draft.preset.slots; i++) {
				if (draft.players[i].name === "") {
					seat = i;
					break;
				}
			}
			if (seat === -1) {
				return res.status(409).render("error", { error: "Lobby full" });
			}
		}

		const token = draftsStore.issueSeatToken();
		draft.players[seat].name = civName;
		draft.players[seat].token = token;
		draftsStore.write(draft);

		setSeatCookie(res, req.draftId, token);
		return res.redirect(`${config.basePath}/draft/${req.draftId}`);
	})
);

/**
 * The host and player invite links show the join form. A visitor who already
 * holds a seat is redirected to the draft page rather than being served it
 * here: draft.html resolves its assets with "../", which is only correct at
 * the /draft/:id depth.
 */
function draftPage(req, res) {
	if (req.playerNumber >= 0) {
		return res.redirect(`${config.basePath}/draft/${req.draftId}`);
	}
	return res.sendFile("join.html", { root: `${config.dirs.public}/html` });
}

router.get("/draft/host/:id", loadDraft, requireDraft, draftPage);
router.get("/draft/player/:id", loadDraft, requireDraft, draftPage);

router.get("/draft/:id", loadDraft, requireDraft, (req, res) => {
	res.sendFile("draft.html", { root: `${config.dirs.public}/html` });
});

module.exports = router;
