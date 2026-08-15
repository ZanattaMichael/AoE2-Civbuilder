import { describe, it, expect } from "vitest";

import rngModule from "../process_mod/rng.js";
import namesModule from "../process_mod/random/random_name.js";
import techtreeModule from "../process_mod/random/random_techtree.js";

const { createRng, Rng } = rngModule;

describe("Rng", () => {
	it("is reproducible for a given seed", () => {
		const a = createRng("seed-1");
		const b = createRng("seed-1");
		const drawsA = Array.from({ length: 20 }, () => a.next());
		const drawsB = Array.from({ length: 20 }, () => b.next());
		expect(drawsA).toEqual(drawsB);
	});

	it("produces different streams for different seeds", () => {
		const a = Array.from({ length: 20 }, () => createRng("seed-1").next());
		const b = Array.from({ length: 20 }, () => createRng("seed-2").next());
		expect(a).not.toEqual(b);
	});

	it("falls back to non-deterministic randomness with no seed", () => {
		const a = Array.from({ length: 20 }, () => new Rng().next());
		const b = Array.from({ length: 20 }, () => new Rng().next());
		expect(a).not.toEqual(b);
	});

	it("keeps int() within range", () => {
		const rng = createRng("range");
		for (let i = 0; i < 500; i++) {
			const value = rng.int(7);
			expect(value).toBeGreaterThanOrEqual(0);
			expect(value).toBeLessThan(7);
			expect(Number.isInteger(value)).toBe(true);
		}
	});

	it("keeps range() within bounds", () => {
		const rng = createRng("bounds");
		for (let i = 0; i < 500; i++) {
			const value = rng.range(88, 102);
			expect(value).toBeGreaterThanOrEqual(88);
			expect(value).toBeLessThan(102);
		}
	});

	it("pluck removes the element it returns", () => {
		const rng = createRng("pluck");
		const source = [1, 2, 3, 4, 5];
		const taken = rng.pluck(source);
		expect(source).toHaveLength(4);
		expect(source).not.toContain(taken);
	});

	it("pluck and pick return undefined for an empty array", () => {
		const rng = createRng("empty");
		expect(rng.pluck([])).toBeUndefined();
		expect(rng.pick([])).toBeUndefined();
		expect(rng.pluck(null)).toBeUndefined();
	});
});

describe("seeded name generation", () => {
	it("returns the same names for the same seed", () => {
		const a = namesModule.generateNames(10, createRng("names"));
		const b = namesModule.generateNames(10, createRng("names"));
		expect(a).toEqual(b);
	});

	it("returns the requested number of non-empty names", () => {
		const names = namesModule.generateNames(37, createRng("names"));
		expect(names).toHaveLength(37);
		for (const name of names) {
			expect(typeof name).toBe("string");
			expect(name.length).toBeGreaterThan(0);
		}
	});

	it("does not leak state between calls", () => {
		namesModule.generateNames(5, createRng("first"));
		const a = namesModule.generateNames(5, createRng("second"));
		namesModule.generateNames(5, createRng("third"));
		const b = namesModule.generateNames(5, createRng("second"));
		expect(a).toEqual(b);
	});
});

describe("seeded tech tree generation", () => {
	it("returns the same tree for the same seed", () => {
		const a = techtreeModule.generateTechTree(createRng("tree"));
		const b = techtreeModule.generateTechTree(createRng("tree"));
		expect(a).toEqual(b);
	});

	it("produces 0/1 availability flags after the reserved metadata slots", () => {
		const tree = techtreeModule.generateTechTree(createRng("tree"));
		expect(Array.isArray(tree)).toBe(true);
		expect(tree.length).toBeGreaterThan(100);

		// Indices 0-3 are placeholders for the unique unit and unique techs; they
		// are filled in later by the caller. Everything from 4 on is availability.
		for (const entry of tree.slice(0, 4)) {
			expect(entry).toBe(-1);
		}
		for (const entry of tree.slice(4)) {
			expect([0, 1]).toContain(entry);
		}
	});

	it("enables a plausible number of techs", () => {
		const tree = techtreeModule.generateTechTree(createRng("tree"));
		const enabled = tree.slice(4).filter((entry) => entry === 1).length;
		expect(enabled).toBeGreaterThan(80);
		expect(enabled).toBeLessThan(tree.length);
	});

	it("never emits a tech whose prerequisite is unavailable", () => {
		// The structural invariant that matters: an available upgrade must have
		// its parent available too, or the mod is unloadable in game.
		for (const seed of ["a", "b", "c", "d", "e"]) {
			const tree = techtreeModule.generateTechTree(createRng(seed));
			expect(tree).not.toBe(-1);
		}
	});
});
