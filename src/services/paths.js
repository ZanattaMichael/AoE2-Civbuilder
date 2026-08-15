"use strict";

const path = require("path");

const config = require("../config");
const { ForbiddenError } = require("../errors");
const { assertSeed, assertDraftId } = require("../validation");

/**
 * Filesystem path construction.
 *
 * Even though identifiers are validated at the edge, every path built from
 * user input is additionally confined to its intended root here. Validation and
 * containment are independent controls: if a future caller forgets to validate,
 * containment still refuses to hand back a path outside the root.
 */

function resolveWithin(root, ...segments) {
	const resolvedRoot = path.resolve(root);
	const target = path.resolve(resolvedRoot, ...segments);
	// path.relative gives "" for the root itself, and a ".."-prefixed value for
	// anything that escapes it.
	const relative = path.relative(resolvedRoot, target);
	if (relative !== "" && (relative.startsWith("..") || path.isAbsolute(relative))) {
		throw new ForbiddenError("Resolved path escapes its permitted root");
	}
	return target;
}

function draftFile(draftId) {
	assertDraftId(draftId);
	return resolveWithin(config.dirs.drafts, `${draftId}.json`);
}

function modRoot(seed) {
	assertSeed(seed);
	return resolveWithin(config.dirs.requestedMods, seed);
}

function modArchive(id) {
	// Mod archives are keyed by seed for /random and /create, and by draft ID for
	// completed drafts. Both alphabets are covered by the seed pattern.
	assertSeed(id, "id");
	return resolveWithin(config.dirs.requestedMods, `${id}.zip`);
}

function modDataJson(seed) {
	return resolveWithin(modRoot(seed), "data.json");
}

function dataModDir(seed) {
	return resolveWithin(modRoot(seed), `${seed}-data`);
}

function uiModDir(seed) {
	return resolveWithin(modRoot(seed), `${seed}-ui`);
}

/** Paths inside a generated mod that the build pipeline writes to. */
function modPaths(seed) {
	const dataDir = dataModDir(seed);
	const uiDir = uiModDir(seed);

	return {
		root: modRoot(seed),
		dataDir,
		uiDir,
		dataJson: modDataJson(seed),
		archive: modArchive(seed),

		civFlags: path.join(uiDir, "widgetui", "textures", "menu", "civs"),
		techtreeButtons: path.join(uiDir, "widgetui", "textures", "ingame", "icons", "civ_techtree_buttons"),
		uiTechtreeIcons: path.join(uiDir, "resources", "_common", "wpfg", "resources", "civ_techtree"),
		dataTechtreeIcons: path.join(dataDir, "resources", "_common", "wpfg", "resources", "civ_techtree"),
		unitIcons: path.join(uiDir, "resources", "_common", "wpfg", "resources", "uniticons"),
		uiResources: path.join(uiDir, "resources"),
		sounds: path.join(uiDir, "resources", "_common", "drs", "sounds"),
		aiDir: path.join(uiDir, "resources", "_common", "ai"),
		aiConfig: path.join(uiDir, "resources", "_common", "ai", "aiconfig.json"),
		moddedStrings: path.join(uiDir, "resources", "en", "strings", "key-value", "key-value-modded-strings-utf8.txt"),

		datFile: path.join(dataDir, "resources", "_common", "dat", "empires2_x2_p1.dat"),
		civTechTreesJson: path.join(dataDir, "resources", "_common", "dat", "civTechTrees.json"),
		civilizationsJson: path.join(dataDir, "resources", "_common", "dat", "civilizations.json"),
	};
}

module.exports = {
	resolveWithin,
	draftFile,
	modRoot,
	modArchive,
	modDataJson,
	dataModDir,
	uiModDir,
	modPaths,
};
