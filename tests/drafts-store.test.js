import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeEach } from "vitest";

import draftsStore from "../src/services/drafts.js";
import draftLogic from "../src/services/draft-logic.js";
import config from "../src/config.js";

function makeDraft(id = "100000000000001") {
	return draftLogic.createDraft({
		id,
		slots: 2,
		points: 100,
		rounds: 3,
		rarities: [true, true, true, true, true],
	});
}

describe("draft persistence", () => {
	beforeEach(() => {
		fs.rmSync(config.dirs.drafts, { recursive: true, force: true });
		fs.mkdirSync(config.dirs.drafts, { recursive: true });
	});

	it("round-trips a draft", () => {
		const draft = makeDraft();
		draftsStore.write(draft);

		expect(draftsStore.exists(draft.id)).toBe(true);
		expect(draftsStore.read(draft.id)).toEqual(draft);
	});

	it("returns null for unknown or invalid IDs instead of throwing", () => {
		expect(draftsStore.read("999999999999999")).toBeNull();
		expect(draftsStore.read("../../etc/passwd")).toBeNull();
		expect(draftsStore.read(null)).toBeNull();
		expect(draftsStore.exists("../../etc/passwd")).toBe(false);
	});

	it("returns null rather than throwing when a draft file is corrupt", () => {
		const id = "100000000000002";
		fs.writeFileSync(path.join(config.dirs.drafts, `${id}.json`), "{not json");
		expect(draftsStore.read(id)).toBeNull();
	});

	it("refuses to persist a draft without a valid id", () => {
		expect(() => draftsStore.write({ id: "../evil" })).toThrow(/valid id/);
		expect(() => draftsStore.write({})).toThrow(/valid id/);
	});

	it("writes atomically, leaving no temp file behind", () => {
		const draft = makeDraft();
		draftsStore.write(draft);
		const stray = fs.readdirSync(config.dirs.drafts).filter((f) => f.endsWith(".tmp"));
		expect(stray).toEqual([]);
	});

	it("generates unique 15-digit IDs", () => {
		const ids = new Set();
		for (let i = 0; i < 50; i++) {
			const id = draftsStore.generateId();
			expect(id).toMatch(/^[0-9]{15}$/);
			ids.add(id);
		}
		expect(ids.size).toBe(50);
	});
});

describe("seat tokens", () => {
	it("issues unguessable, distinct tokens", () => {
		const a = draftsStore.issueSeatToken();
		const b = draftsStore.issueSeatToken();
		expect(a).toMatch(/^[0-9a-f]{64}$/);
		expect(a).not.toBe(b);
	});

	it("resolves a token to the seat that owns it", () => {
		const draft = makeDraft();
		const hostToken = draftsStore.issueSeatToken();
		const playerToken = draftsStore.issueSeatToken();
		draft.players[0].token = hostToken;
		draft.players[1].token = playerToken;

		expect(draftsStore.resolveSeat(draft, hostToken)).toBe(0);
		expect(draftsStore.resolveSeat(draft, playerToken)).toBe(1);
	});

	it("treats unknown, empty and malformed tokens as spectators", () => {
		const draft = makeDraft();
		draft.players[0].token = draftsStore.issueSeatToken();

		expect(draftsStore.resolveSeat(draft, "wrong")).toBe(-1);
		expect(draftsStore.resolveSeat(draft, "")).toBe(-1);
		expect(draftsStore.resolveSeat(draft, null)).toBe(-1);
		expect(draftsStore.resolveSeat(null, "anything")).toBe(-1);
	});

	it("does not let a token from one draft claim a seat in another", () => {
		const draftA = makeDraft("100000000000003");
		const draftB = makeDraft("100000000000004");
		const tokenA = draftsStore.issueSeatToken();
		draftA.players[0].token = tokenA;
		draftB.players[0].token = draftsStore.issueSeatToken();

		expect(draftsStore.resolveSeat(draftB, tokenA)).toBe(-1);
	});
});

describe("toPublic", () => {
	it("strips seat tokens so players cannot impersonate each other", () => {
		const draft = makeDraft();
		draft.players[0].token = draftsStore.issueSeatToken();
		draft.players[1].token = draftsStore.issueSeatToken();

		const published = draftsStore.toPublic(draft);

		expect(JSON.stringify(published)).not.toContain(draft.players[0].token);
		for (const player of published.players) {
			expect(player).not.toHaveProperty("token");
		}
	});

	it("leaves the original draft untouched", () => {
		const draft = makeDraft();
		draft.players[0].token = "keepme";
		draftsStore.toPublic(draft);
		expect(draft.players[0].token).toBe("keepme");
	});

	it("preserves the rest of the gamestate", () => {
		const draft = makeDraft();
		draft.players[0].token = draftsStore.issueSeatToken();
		const published = draftsStore.toPublic(draft);

		expect(published.id).toBe(draft.id);
		expect(published.preset).toEqual(draft.preset);
		expect(published.gamestate.phase).toBe(draft.gamestate.phase);
	});
});
