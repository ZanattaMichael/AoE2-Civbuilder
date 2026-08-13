import { describe, it, expect } from "vitest";

import modData from "../src/services/mod-data.js";
import draftLogic from "../src/services/draft-logic.js";
import constants from "../process_mod/constants.js";

const { buildTechtreeVector, fromPresets, fromDraft } = modData;
const { numBasicTechs, indexDictionary } = constants;

describe("buildTechtreeVector", () => {
	it("produces a dense vector of the expected length", () => {
		const vector = buildTechtreeVector([[], [], []], 3);
		expect(vector).toHaveLength(numBasicTechs);
	});

	it("reserves index 0 for the unique unit", () => {
		expect(buildTechtreeVector([[], [], []], 7)[0]).toBe(7);
	});

	it("maps selected techs through the index dictionary", () => {
		// Pick a real entry from the dictionary so the mapping is exercised.
		const [techId, targetIndex] = Object.entries(indexDictionary[0])[0];
		const vector = buildTechtreeVector([[Number(techId)], [], []], 0);
		expect(vector[targetIndex]).toBe(1);
	});

	it("drops unknown tech IDs instead of writing outside the vector", () => {
		const vector = buildTechtreeVector([[99999999], [], []], 0);
		expect(vector).toHaveLength(numBasicTechs);
		expect(vector.filter((v) => v === 1)).toHaveLength(0);
	});

	it("tolerates a missing or malformed tree", () => {
		expect(buildTechtreeVector(undefined, 0)).toHaveLength(numBasicTechs);
		expect(buildTechtreeVector("not an array", 0)).toHaveLength(numBasicTechs);
		expect(buildTechtreeVector([null, undefined, {}], 0)).toHaveLength(numBasicTechs);
	});
});

describe("fromPresets", () => {
	const preset = {
		alias: "Test Civ",
		description: "A civ",
		wonder: 2,
		castle: 3,
		architecture: 5,
		language: 4,
		tree: [[], [], []],
		bonuses: [[[1, 1]], [9], [11], [12], [13]],
	};

	it("produces parallel arrays of equal length", () => {
		const data = fromPresets([preset, preset], {});
		for (const key of ["name", "description", "techtree", "castletech", "imptech", "civ_bonus", "team_bonus", "architecture", "language", "wonder", "castle"]) {
			expect(data[key], key).toHaveLength(2);
		}
	});

	it("carries the unique unit into the tech tree vector", () => {
		const data = fromPresets([preset], {});
		expect(data.techtree[0][0]).toBe(9);
	});

	it("normalizes modifiers rather than trusting them", () => {
		const data = fromPresets([preset], { hp: 99999, evil: "payload" });
		expect(data.modifiers.hp).toBe(100);
		expect(data.modifiers).not.toHaveProperty("evil");
	});

	it("sanitizes civilization names and descriptions", () => {
		const NUL = String.fromCharCode(0);
		const data = fromPresets([{ ...preset, alias: `Evil${NUL}Civ`, description: "x".repeat(5000) }], {});
		expect(data.name[0]).toBe("EvilCiv");
		expect(data.description[0].length).toBeLessThanOrEqual(1000);
	});

	it("supplies defaults for missing optional fields", () => {
		const data = fromPresets([{ bonuses: [[], [], [], [], []], tree: [[], [], []] }], {});
		expect(data.architecture[0]).toBe(1);
		expect(data.language[0]).toBe(0);
		expect(data.wonder[0]).toBe(0);
		expect(data.castle[0]).toBe(0);
		expect(data.castletech[0]).toEqual([0]);
	});
});

describe("fromDraft", () => {
	it("builds mod data for exactly the occupied slots", () => {
		const draft = draftLogic.createDraft({
			id: "100000000000001",
			slots: 3,
			points: 100,
			rounds: 2,
			rarities: [true, true, true, true, true],
		});
		draft.players.forEach((player, i) => {
			player.alias = `Civ ${i}`;
			player.bonuses = [[[1, 1]], [i], [2], [3], [4]];
		});

		const data = fromDraft(draft);
		expect(data.name).toEqual(["Civ 0", "Civ 1", "Civ 2"]);
		expect(data.techtree).toHaveLength(3);
		expect(data.techtree[2][0]).toBe(2);
	});

	it("takes only the first entry for single-slot bonus categories", () => {
		const draft = draftLogic.createDraft({
			id: "100000000000002",
			slots: 1,
			points: 100,
			rounds: 2,
			rarities: [true, true, true, true, true],
		});
		draft.players[0].bonuses = [[], [0], [5, 6, 7], [8, 9], [10, 11]];

		const data = fromDraft(draft);
		expect(data.castletech[0]).toEqual([5]);
		expect(data.imptech[0]).toEqual([8]);
		expect(data.team_bonus[0]).toEqual([10]);
	});
});
