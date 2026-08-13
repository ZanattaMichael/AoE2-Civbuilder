import { describe, it, expect, beforeEach } from "vitest";

import draftLogic from "../src/services/draft-logic.js";
import rngModule from "../process_mod/rng.js";

const { createDraft, roundTypeFor, currentPlayer, applyPick, refillCards, clearCards, dealCards, assignTurnOrder, allPlayersReady, resetReady, reshuffleCards, PHASES } = draftLogic;
const { createRng } = rngModule;

function makeDraft({ slots = 3, rounds = 2 } = {}) {
	return createDraft({
		id: "100000000000001",
		slots,
		points: 100,
		rounds,
		rarities: [true, true, true, true, true],
	});
}

/** Puts a draft into the drafting phase with a known board and turn order. */
function startDrafting(draft, cards = [10, 11, 12, 13, 14, 15]) {
	draft.gamestate.phase = PHASES.DRAFTING;
	draft.gamestate.cards = [...cards];
	draft.gamestate.order = draft.players.map((_, i) => i);
	return draft;
}

describe("draft creation", () => {
	it("creates one player per slot with default state", () => {
		const draft = makeDraft({ slots: 4 });
		expect(draft.players).toHaveLength(4);
		for (const player of draft.players) {
			expect(player.ready).toBe(0);
			expect(player.name).toBe("");
			expect(player.bonuses).toEqual([[], [], [], [], []]);
		}
	});

	it("gives each player an independent copy of the default tech tree", () => {
		const draft = makeDraft({ slots: 2 });
		draft.players[0].tree[0].push(9999);
		expect(draft.players[1].tree[0]).not.toContain(9999);
	});

	it("only offers cards of the allowed rarities", () => {
		const draft = createDraft({
			id: "100000000000002",
			slots: 2,
			points: 100,
			rounds: 2,
			rarities: [true, false, false, false, false],
		});
		// With only one rarity enabled the decks must be strictly smaller than
		// with all five enabled.
		const permissive = makeDraft({ slots: 2 });
		expect(draft.gamestate.available_cards[0].length).toBeLessThan(permissive.gamestate.available_cards[0].length);
	});
});

describe("turn order", () => {
	it("advances through players in order on odd rounds", () => {
		const draft = startDrafting(makeDraft({ slots: 3, rounds: 2 }));
		expect(currentPlayer(draft)).toBe(draft.gamestate.order[0]);
		draft.gamestate.turn = 1;
		expect(currentPlayer(draft)).toBe(draft.gamestate.order[1]);
	});

	it("reverses direction on snake rounds 2 and 4", () => {
		const draft = startDrafting(makeDraft({ slots: 3, rounds: 1 }));
		// roundType 2 begins at turn = slots * (rounds - 1 + 2)
		draft.gamestate.turn = 3 * 2;
		expect(roundTypeFor(draft)).toBe(2);
		expect(currentPlayer(draft)).toBe(draft.gamestate.order[2]);
	});

	it("assigns a complete permutation of seats", () => {
		const draft = makeDraft({ slots: 5 });
		assignTurnOrder(draft, createRng("order-seed"));
		expect([...draft.gamestate.order].sort()).toEqual([0, 1, 2, 3, 4]);
	});
});

describe("applyPick authorization", () => {
	let draft;

	beforeEach(() => {
		draft = startDrafting(makeDraft({ slots: 3, rounds: 2 }));
	});

	it("accepts a pick from the player whose turn it is", () => {
		const result = applyPick(draft, currentPlayer(draft), 10, 0);
		expect(result.ok).toBe(true);
		expect(draft.gamestate.turn).toBe(1);
	});

	it("rejects a pick from a player acting out of turn", () => {
		const wrongPlayer = (currentPlayer(draft) + 1) % 3;
		const result = applyPick(draft, wrongPlayer, 10, 0);

		expect(result.ok).toBe(false);
		expect(result.reason).toBe("not-your-turn");
		// The board and turn counter are untouched.
		expect(draft.gamestate.turn).toBe(0);
		expect(draft.gamestate.cards).toContain(10);
		expect(draft.players[wrongPlayer].bonuses[0]).toEqual([]);
	});

	it("rejects a card that is not on the board", () => {
		const result = applyPick(draft, currentPlayer(draft), 9999, 0);
		expect(result.ok).toBe(false);
		expect(result.reason).toBe("card-not-on-board");
		expect(draft.gamestate.turn).toBe(0);
	});

	it("rejects an already-taken slot marked as -1", () => {
		draft.gamestate.cards[0] = -1;
		const result = applyPick(draft, currentPlayer(draft), -1, 0);
		expect(result.ok).toBe(false);
	});

	it("ignores a duplicated message for a turn that already resolved", () => {
		applyPick(draft, currentPlayer(draft), 10, 0);
		const replay = applyPick(draft, currentPlayer(draft), 11, 0);

		expect(replay.ok).toBe(false);
		expect(replay.reason).toBe("stale-turn");
		expect(draft.gamestate.turn).toBe(1);
	});

	it("marks the chosen card unavailable to the other players", () => {
		applyPick(draft, currentPlayer(draft), 10, 0);
		expect(draft.gamestate.cards).not.toContain(10);
		expect(draft.gamestate.cards).toContain(-1);
	});

	it("awards the card to the picking player", () => {
		const player = currentPlayer(draft);
		applyPick(draft, player, 12, 0);
		expect(draft.players[player].bonuses[0]).toEqual([12]);
	});
});

describe("card board management", () => {
	it("refills only the empty slots and reports which were refilled", () => {
		const draft = startDrafting(makeDraft({ slots: 2 }), [1, -1, 3, -1]);
		refillCards(draft, createRng("refill"));

		expect(draft.gamestate.cards[0]).toBe(1);
		expect(draft.gamestate.cards[2]).toBe(3);
		expect(draft.gamestate.cards[1]).not.toBe(-1);
		expect(draft.gamestate.highlighted).toEqual([1, 3]);
	});

	it("replaces the whole board on clear", () => {
		const draft = startDrafting(makeDraft({ slots: 2 }), [1, 2, 3]);
		clearCards(draft, createRng("clear"));

		expect(draft.gamestate.cards).toHaveLength(3);
		expect(draft.gamestate.cards).not.toContain(-1);
		expect(draft.gamestate.highlighted).toEqual([0, 1, 2]);
	});

	it("deals without repeating a card", () => {
		const draft = makeDraft({ slots: 2 });
		dealCards(draft, 0, 25, createRng("deal"));
		expect(new Set(draft.gamestate.cards).size).toBe(draft.gamestate.cards.length);
	});

	it("stops dealing when the deck runs dry rather than pushing undefined", () => {
		const draft = makeDraft({ slots: 2 });
		const deckSize = draft.gamestate.available_cards[0].length;
		dealCards(draft, 0, deckSize + 50, createRng("dry"));

		expect(draft.gamestate.cards).toHaveLength(deckSize);
		expect(draft.gamestate.cards).not.toContain(undefined);
	});

	it("reshuffle excludes cards already owned or on the board", () => {
		const draft = startDrafting(makeDraft({ slots: 2 }), [5]);
		draft.players[0].bonuses[0] = [7];

		const available = reshuffleCards(draft);
		expect(available).not.toContain(5);
		expect(available).not.toContain(7);
	});
});

describe("readiness", () => {
	it("reports ready only when every player is ready", () => {
		const draft = makeDraft({ slots: 3 });
		expect(allPlayersReady(draft)).toBe(false);
		draft.players.forEach((p) => (p.ready = 1));
		expect(allPlayersReady(draft)).toBe(true);
	});

	it("resets every player's ready flag", () => {
		const draft = makeDraft({ slots: 3 });
		draft.players.forEach((p) => (p.ready = 1));
		resetReady(draft);
		expect(draft.players.every((p) => p.ready === 0)).toBe(true);
	});
});
