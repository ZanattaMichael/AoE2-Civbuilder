"use strict";

const { numBasicTechs, indexDictionary } = require("../../process_mod/constants.js");
const { sanitizeText, normalizeModifiers } = require("../validation");

/**
 * Assembly of the `data.json` document consumed by the native .dat rewriter.
 *
 * Kept pure (no I/O) so the mapping from user presets to mod data can be
 * verified directly.
 */

function emptyModData() {
	return {
		name: [],
		description: [],
		techtree: [],
		castletech: [],
		imptech: [],
		civ_bonus: [],
		team_bonus: [],
		architecture: [],
		language: [],
		wonder: [],
		castle: [],
	};
}

/**
 * Expands a civilization's sparse tech selections into the dense 0/1 vector the
 * .dat rewriter expects. Index 0 is reserved for the unique unit.
 */
function buildTechtreeVector(tree, uniqueUnit) {
	const vector = new Array(numBasicTechs).fill(0);
	vector[0] = uniqueUnit;

	if (!Array.isArray(tree)) {
		return vector;
	}

	for (let category = 0; category < tree.length; category++) {
		const entries = tree[category];
		if (!Array.isArray(entries) || !indexDictionary[category]) {
			continue;
		}
		for (const entry of entries) {
			const index = indexDictionary[category][String(entry)];
			// Unknown tech IDs are dropped rather than writing outside the vector.
			if (Number.isInteger(index) && index > 0 && index < numBasicTechs) {
				vector[index] = 1;
			}
		}
	}
	return vector;
}

function firstBonusOrZero(bonuses, slot) {
	const list = bonuses && bonuses[slot];
	return Array.isArray(list) && list.length > 0 ? list : [0];
}

function uniqueUnitOf(bonuses) {
	const list = bonuses && bonuses[1];
	return Array.isArray(list) && list.length > 0 ? list[0] : 0;
}

/** Builds mod data from the civilization-builder preset format. */
function fromPresets(civs, modifiers) {
	const modData = emptyModData();
	modData.modifiers = normalizeModifiers(modifiers);
	modData.modifyDat = true;

	for (const civ of civs) {
		modData.name.push(sanitizeText(civ.alias, { maxLength: 64 }));
		modData.description.push(sanitizeText(civ.description, { maxLength: 1000 }));
		modData.wonder.push(civ.wonder || 0);
		modData.castle.push(civ.castle || 0);
		modData.architecture.push(civ.architecture === undefined ? 1 : civ.architecture);
		modData.language.push(civ.language === undefined ? 0 : civ.language);

		modData.techtree.push(buildTechtreeVector(civ.tree, uniqueUnitOf(civ.bonuses)));
		modData.castletech.push(firstBonusOrZero(civ.bonuses, 2));
		modData.imptech.push(firstBonusOrZero(civ.bonuses, 3));
		modData.civ_bonus.push((civ.bonuses && civ.bonuses[0]) || []);
		modData.team_bonus.push(firstBonusOrZero(civ.bonuses, 4));
	}

	return modData;
}

/** Builds mod data from the state of a completed draft. */
function fromDraft(draft) {
	const modData = emptyModData();
	modData.modifiers = normalizeModifiers({});
	modData.modifyDat = true;

	for (let i = 0; i < draft.preset.slots; i++) {
		const player = draft.players[i];
		modData.name.push(sanitizeText(player.alias, { maxLength: 64 }));
		modData.description.push(sanitizeText(player.description, { maxLength: 1000 }));
		modData.castle.push(player.castle || 0);
		modData.wonder.push(player.wonder || 0);
		modData.architecture.push(player.architecture === undefined ? 1 : player.architecture);
		modData.language.push(player.language === undefined ? 0 : player.language);

		modData.techtree.push(buildTechtreeVector(player.tree, uniqueUnitOf(player.bonuses)));
		modData.castletech.push([firstBonusOrZero(player.bonuses, 2)[0]]);
		modData.imptech.push([firstBonusOrZero(player.bonuses, 3)[0]]);
		modData.civ_bonus.push((player.bonuses && player.bonuses[0]) || []);
		modData.team_bonus.push([firstBonusOrZero(player.bonuses, 4)[0]]);
	}

	return modData;
}

module.exports = {
	emptyModData,
	buildTechtreeVector,
	fromPresets,
	fromDraft,
};
