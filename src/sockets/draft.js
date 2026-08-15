"use strict";

const cookie = require("cookie");
const cookieParser = require("cookie-parser");

const config = require("../config");
const logger = require("../logger");
const draftsStore = require("../services/drafts");
const draftLogic = require("../services/draft-logic");
const modData = require("../services/mod-data");
const modBuilder = require("../services/mod-builder");
const { isValidDraftId, sanitizeText, assertInteger } = require("../validation");
const { SEAT_COOKIE } = require("../middleware/auth");

/**
 * Draft socket handlers.
 *
 * Previously every handler accepted a room ID and a player number straight from
 * the client and acted on them, so any connected socket could act as any player
 * in any draft: pick another player's cards, overwrite their tech tree, or clear
 * the board. Each socket now proves its seat once at handshake time via the
 * signed cookie, and the seat is read from the connection rather than the
 * message.
 */

/** Extracts and unsigns the seat token from the handshake cookies. */
function seatTokenFromHandshake(socket) {
	const header = socket.handshake.headers.cookie;
	if (!header) {
		return null;
	}
	let parsed;
	try {
		parsed = cookie.parse(header);
	} catch {
		return null;
	}
	const raw = parsed[SEAT_COOKIE];
	// signedCookie() returns an unprefixed value unchanged rather than rejecting
	// it, so the "s:" prefix must be required explicitly. Without this check an
	// attacker could present an unsigned cookie and have it accepted verbatim.
	if (!raw || !raw.startsWith("s:")) {
		return null;
	}
	const unsigned = cookieParser.signedCookie(raw, config.cookieSecret);
	return unsigned === false ? null : unsigned;
}

function broadcast(io, roomId, draft) {
	io.in(roomId).emit("set gamestate", draftsStore.toPublic(draft));
}

function emitToSocket(socket, draft) {
	socket.emit("set gamestate", draftsStore.toPublic(draft));
}

function register(io) {
	io.on("connection", (socket) => {
		// Seat state is established once, at connect time, and cached on the
		// socket. Clients cannot change it by sending a different room ID.
		let joinedRoom = null;
		let seat = -1;

		const currentDraft = () => (joinedRoom ? draftsStore.read(joinedRoom) : null);

		/** Loads the draft and asserts the socket holds a seat in it. */
		const withSeat =
			(handler) =>
			(...args) => {
				const draft = currentDraft();
				if (!draft) {
					return;
				}
				if (seat < 0) {
					logger.warn(`Spectator socket ${socket.id} attempted a player action in ${joinedRoom}`);
					return;
				}
				try {
					handler(draft, ...args);
				} catch (err) {
					logger.error(`Socket handler failed for ${joinedRoom}: ${err.stack || err.message}`);
				}
			};

		socket.on("join room", (roomID) => {
			if (!isValidDraftId(roomID)) {
				return;
			}
			const draft = draftsStore.read(roomID);
			if (!draft) {
				return;
			}

			joinedRoom = roomID;
			socket.join(roomID);

			const token = seatTokenFromHandshake(socket);
			seat = token ? draftsStore.resolveSeat(draft, token) : -1;

			// The client is told which seat it holds; it is no longer trusted to
			// assert one.
			socket.emit("seat assigned", seat);
		});

		socket.on("get gamestate", () => {
			const draft = currentDraft();
			if (draft) {
				emitToSocket(socket, draft);
			}
		});

		socket.on("get private gamestate", () => {
			const draft = currentDraft();
			if (draft) {
				emitToSocket(socket, draft);
			}
		});

		socket.on(
			"toggle ready",
			withSeat((draft) => {
				draft.players[seat].ready = (draft.players[seat].ready + 1) % 2;
				draftsStore.write(draft);
				broadcast(io, joinedRoom, draft);
			})
		);

		socket.on(
			"start draft",
			withSeat((draft) => {
				// Only the host may start the draft.
				if (seat !== 0) {
					logger.warn(`Non-host seat ${seat} attempted to start draft ${joinedRoom}`);
					return;
				}
				draft.gamestate.phase = draftLogic.PHASES.CIV_SETUP;
				draftLogic.resetReady(draft);
				draftsStore.write(draft);
				broadcast(io, joinedRoom, draft);
			})
		);

		socket.on(
			"update civ info",
			withSeat((draft, civName, flagPalette, architecture, language) => {
				const player = draft.players[seat];
				player.ready = 1;
				player.alias = sanitizeText(civName, { maxLength: 64 });
				if (Array.isArray(flagPalette) && flagPalette.length === 8) {
					player.flag_palette = flagPalette.map((value) => assertInteger(value, "flag_palette", { min: -1, max: 255 }));
				}
				player.architecture = assertInteger(architecture, "architecture", { min: 0, max: 11 });
				player.language = assertInteger(language, "language", { min: 0, max: 100 });

				if (draftLogic.allPlayersReady(draft)) {
					draft.gamestate.phase = draftLogic.PHASES.DRAFTING;
					draftLogic.resetReady(draft);
					draftLogic.dealCards(draft, 0, (draft.preset.rounds - 1) * draft.preset.slots + 30);
					draftLogic.assignTurnOrder(draft);
					draftsStore.write(draft);
					broadcast(io, joinedRoom, draft);
				} else {
					draftsStore.write(draft);
				}
			})
		);

		socket.on(
			"update tree",
			withSeat((draft, tree) => {
				if (!Array.isArray(tree)) {
					return;
				}
				draft.players[seat].tree = tree;
				draft.players[seat].ready = 1;

				if (!draftLogic.allPlayersReady(draft)) {
					draftsStore.write(draft);
					return;
				}

				draft.gamestate.phase = draftLogic.PHASES.GENERATING;
				draftsStore.write(draft);
				broadcast(io, joinedRoom, draft);

				const roomId = joinedRoom;
				buildDraftMod(io, roomId).catch((err) => {
					logger.error(`Mod generation failed for draft ${roomId}: ${err.stack || err.message}`);
					io.in(roomId).emit("generation failed", { error: "Mod creation failed" });
				});
			})
		);

		socket.on(
			"end turn",
			withSeat((draft, pick, clientTurn) => {
				const result = draftLogic.applyPick(draft, seat, pick, clientTurn);
				if (!result.ok) {
					logger.debug(`Rejected pick in ${joinedRoom} from seat ${seat}: ${result.reason}`);
					return;
				}
				draftsStore.write(draft);
				broadcast(io, joinedRoom, draft);
			})
		);

		socket.on(
			"refill",
			withSeat((draft) => {
				draftLogic.refillCards(draft);
				draftsStore.write(draft);
				broadcast(io, joinedRoom, draft);
			})
		);

		socket.on(
			"clear",
			withSeat((draft) => {
				draftLogic.clearCards(draft);
				draftsStore.write(draft);
				broadcast(io, joinedRoom, draft);
			})
		);
	});
}

/** Generates the mod for a completed draft and advances it to the final phase. */
async function buildDraftMod(io, roomId) {
	const draft = draftsStore.read(roomId);
	if (!draft) {
		return;
	}

	const data = modData.fromDraft(draft);
	await modBuilder.buildPresetMod(roomId, data, draft.players.slice(0, draft.preset.slots));

	const updated = draftsStore.read(roomId);
	updated.gamestate.phase = draftLogic.PHASES.COMPLETE;
	draftsStore.write(updated);
	broadcast(io, roomId, updated);
}

module.exports = { register, buildDraftMod, seatTokenFromHandshake };
