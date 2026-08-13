"use strict";

const { numBonuses } = require("../../process_mod/constants.js");
const commonJs = require("../../public/js/common.js");
const { defaultRng } = require("../../process_mod/rng.js");

/**
 * Pure draft rules.
 *
 * Extracted from the socket handlers so the game logic can be exercised without
 * a running server, and so the handlers are left doing only authorization and
 * I/O.
 */

const DEFAULT_TREE = [
	[13, 17, 21, 74, 545, 539, 331, 125, 83, 128, 440],
	[12, 45, 49, 50, 68, 70, 72, 79, 82, 84, 87, 101, 103, 104, 109, 199, 209, 276, 562, 584, 598, 621, 792],
	[22, 101, 102, 103, 408],
];

const PHASES = {
	LOBBY: 0,
	CIV_SETUP: 1,
	DRAFTING: 2,
	TREE_BUILDING: 3,
	GENERATING: 5,
	COMPLETE: 6,
};

function createPlayer() {
	return {
		ready: 0,
		name: "",
		alias: "",
		description: "",
		wonder: 0,
		castle: 0,
		// Palette (color1..color5), division, overlay, symbol
		flag_palette: [3, 4, 5, 6, 7, 3, 3, 3],
		tree: JSON.parse(JSON.stringify(DEFAULT_TREE)),
		architecture: 1,
		language: 0,
		priority: -1,
		bonuses: [[], [], [], [], []],
	};
}

/** Which of the five card rounds the draft is currently in. */
function roundTypeFor(draft) {
	const numPlayers = draft.preset.slots;
	return Math.max(Math.floor(draft.gamestate.turn / numPlayers) - (draft.preset.rounds - 1), 0);
}

/** Whose turn it is. Rounds 2 and 4 run in reverse (snake) order. */
function currentPlayer(draft) {
	const numPlayers = draft.preset.slots;
	const roundType = roundTypeFor(draft);
	const index = draft.gamestate.turn % numPlayers;
	if (roundType === 2 || roundType === 4) {
		return draft.gamestate.order[numPlayers - 1 - index];
	}
	return draft.gamestate.order[index];
}

function buildAvailableCards(rarities) {
	const availableCards = [];
	for (let i = 0; i < 5; i++) {
		const bonuses = [];
		for (let j = 0; j < numBonuses[i]; j++) {
			if (rarities[commonJs.card_descriptions[i][j][1]]) {
				bonuses.push(j);
			}
		}
		availableCards.push(bonuses);
	}
	return availableCards;
}

function createDraft({ id, slots, points, rounds, rarities }) {
	const players = [];
	for (let i = 0; i < slots; i++) {
		players.push(createPlayer());
	}

	return {
		id,
		timestamp: Date.now(),
		preset: { slots, points, rounds, rarities },
		players,
		gamestate: {
			phase: PHASES.LOBBY,
			turn: 0,
			available_cards: buildAvailableCards(rarities),
			cards: [],
			order: [],
			highlighted: [],
		},
	};
}

/** Cards nobody owns and that are not already on the board. */
function reshuffleCards(draft) {
	const numPlayers = draft.preset.slots;
	const roundType = roundTypeFor(draft);
	const available = [];

	for (let i = 0; i < numBonuses[roundType]; i++) {
		let discarded = true;
		for (let j = 0; j < numPlayers; j++) {
			if (draft.players[j].bonuses[roundType].includes(i)) {
				discarded = false;
			}
		}
		if (draft.gamestate.cards.includes(i)) {
			discarded = false;
		}
		if (discarded && draft.preset.rarities[commonJs.card_descriptions[roundType][i][1]]) {
			available.push(i);
		}
	}
	return available;
}

/** Draws `count` cards from the given round's deck into the board. */
function dealCards(draft, roundType, count, rng = defaultRng) {
	const deck = draft.gamestate.available_cards[roundType];
	for (let i = 0; i < count && deck.length > 0; i++) {
		draft.gamestate.cards.push(rng.pluck(deck));
	}
	return draft;
}

/** Randomises turn order once every player has locked in their civ. */
function assignTurnOrder(draft, rng = defaultRng) {
	const numPlayers = draft.preset.slots;
	const priorities = [];
	for (let i = 0; i < numPlayers; i++) {
		priorities.push(rng.next());
	}
	for (let i = 0; i < numPlayers; i++) {
		let maxIndex = 0;
		for (let j = 0; j < numPlayers; j++) {
			if (priorities[j] > priorities[maxIndex]) {
				maxIndex = j;
			}
		}
		draft.gamestate.order.push(maxIndex);
		priorities[maxIndex] = -1;
	}
	return draft;
}

function allPlayersReady(draft) {
	for (let i = 0; i < draft.preset.slots; i++) {
		if (draft.players[i].ready !== 1) {
			return false;
		}
	}
	return true;
}

function resetReady(draft) {
	for (let i = 0; i < draft.preset.slots; i++) {
		draft.players[i].ready = 0;
	}
	return draft;
}

/** Fills empty board slots, recording which indices were refilled. */
function refillCards(draft, rng = defaultRng) {
	const roundType = roundTypeFor(draft);
	draft.gamestate.highlighted = [];

	for (let i = 0; i < draft.gamestate.cards.length; i++) {
		if (draft.gamestate.cards[i] === -1) {
			if (draft.gamestate.available_cards[roundType].length <= 0) {
				draft.gamestate.available_cards[roundType] = reshuffleCards(draft);
			}
			draft.gamestate.cards[i] = rng.pluck(draft.gamestate.available_cards[roundType]) ?? -1;
			draft.gamestate.highlighted.push(i);
		}
	}
	return draft;
}

/** Replaces the whole board, e.g. when a player uses their reroll. */
function clearCards(draft, rng = defaultRng) {
	const roundType = roundTypeFor(draft);
	draft.gamestate.highlighted = [0, 1, 2];

	for (let i = 0; i < draft.gamestate.cards.length; i++) {
		if (draft.gamestate.available_cards[roundType].length <= 0) {
			draft.gamestate.available_cards[roundType] = reshuffleCards(draft);
		}
		draft.gamestate.cards[i] = rng.pluck(draft.gamestate.available_cards[roundType]) ?? -1;
	}
	return draft;
}

/**
 * Applies a player's pick and advances the turn.
 * @returns {{ok: boolean, reason?: string, bug?: boolean}}
 */
function applyPick(draft, playerNumber, pick, clientTurn, rng = defaultRng) {
	const numPlayers = draft.preset.slots;
	const roundType = roundTypeFor(draft);
	const expectedPlayer = currentPlayer(draft);

	if (clientTurn !== draft.gamestate.turn) {
		// A duplicated socket message for a turn that already resolved.
		return { ok: false, reason: "stale-turn" };
	}
	if (playerNumber !== expectedPlayer) {
		return { ok: false, reason: "not-your-turn" };
	}
	if (!draft.gamestate.cards.includes(pick)) {
		return { ok: false, reason: "card-not-on-board" };
	}

	draft.gamestate.highlighted = [];
	draft.players[playerNumber].bonuses[roundType].push(pick);

	const isLastTurnOfRound = draft.gamestate.turn % numPlayers === numPlayers - 1;
	const pastInitialRounds = roundType > 0 || Math.floor(draft.gamestate.turn / numPlayers) === draft.preset.rounds - 1;

	if (pastInitialRounds && isLastTurnOfRound) {
		if (roundType === 4) {
			draft.gamestate.phase = PHASES.TREE_BUILDING;
		} else {
			draft.gamestate.cards = [];
			dealCards(draft, roundType + 1, 2 * numPlayers + 20, rng);
		}
	} else {
		// The board membership check above guarantees this index resolves. The
		// original code tracked a "THE BUG HAPPENED" case here; it was a symptom
		// of accepting unvalidated picks, which the guard now prevents.
		draft.gamestate.cards[draft.gamestate.cards.indexOf(pick)] = -1;
	}

	draft.gamestate.turn++;
	if (draft.gamestate.phase === PHASES.TREE_BUILDING) {
		resetReady(draft);
	}

	return { ok: true };
}

module.exports = {
	DEFAULT_TREE,
	PHASES,
	createPlayer,
	createDraft,
	buildAvailableCards,
	roundTypeFor,
	currentPlayer,
	reshuffleCards,
	dealCards,
	assignTurnOrder,
	allPlayersReady,
	resetReady,
	refillCards,
	clearCards,
	applyPick,
};
