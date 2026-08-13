"use strict";

const fs = require("fs/promises");
const path = require("path");

const config = require("../config");
const logger = require("../logger");
const { run } = require("./command");
const { modPaths } = require("./paths");
const scaffold = require("./mod-scaffold");
const { createRng } = require("../../process_mod/rng.js");

const icons = require("../../process_mod/random/random_icon.js");
const makejson = require("../../process_mod/random/random_json.js");
const modStrings = require("../../process_mod/modStrings.js");
const createTechtreeJson = require("../../process_mod/createTechtreeJson.js");
const makeai = require("../../process_mod/modAI.js");
const { createCivilizationsJson } = require("../../process_mod/createCivilizationsJson.js");
const { nameArr, colours, iconids, blanks } = require("../../process_mod/constants.js");

/**
 * The mod generation pipeline.
 *
 * Previously this was a chain of a dozen Express middlewares, each shelling out
 * with request data spliced into a command string and each depending on the
 * process's current working directory. It is now a linear async function over
 * absolute paths, with the single genuinely-native step (the .dat rewrite)
 * invoked through execFile.
 */

/** Civilizations whose flag asset uses a trailing "s" in the vanilla files. */
const PLURAL_FLAG_CIVS = new Set(["berber", "inca"]);

function flagFileName(civName) {
	return PLURAL_FLAG_CIVS.has(civName) ? `${civName}s.png` : `${civName}.png`;
}

/** Every path a single civilization's flag must be written to. */
function flagTargets(paths, civName) {
	return [
		path.join(paths.civFlags, flagFileName(civName)),
		path.join(paths.techtreeButtons, `menu_techtree_${civName}.png`),
		path.join(paths.techtreeButtons, `menu_techtree_${civName}_hover.png`),
		path.join(paths.techtreeButtons, `menu_techtree_${civName}_pressed.png`),
		path.join(paths.dataTechtreeIcons, `menu_techtree_${civName}.png`),
		path.join(paths.dataTechtreeIcons, `menu_techtree_${civName}_hover.png`),
		path.join(paths.dataTechtreeIcons, `menu_techtree_${civName}_pressed.png`),
	];
}

/** Copies the unique-unit icon for each civilization into the UI mod. */
async function writeUnitIcons(seed, techtree) {
	const paths = modPaths(seed);

	for (const blank of blanks) {
		await scaffold.copyIfExists(path.join(config.dirs.unitIcons, "blank.png"), path.join(paths.unitIcons, `${blank}_50730.png`));
	}

	for (const civ of techtree) {
		const iconSrc = iconids[civ[0]];
		if (iconSrc === undefined) {
			continue;
		}
		await scaffold.copyIfExists(path.join(config.dirs.unitIcons, `${iconSrc}_50730.png`), path.join(paths.unitIcons, `${iconSrc}_50730.png`));
	}
}

/** Invokes the native .dat rewriting binary. No shell is involved. */
async function writeDatFile(seed) {
	const paths = modPaths(seed);
	logger.info(`[${seed}] Writing dat file`);

	await run(config.files.createDataMod, [paths.dataJson, config.files.vanillaDat, paths.datFile, paths.aiConfig]);
}

/** Renders each civilization's flag from its palette, or writes an uploaded one. */
async function writeCivFlags(seed, civs) {
	const paths = modPaths(seed);

	for (let i = 0; i < civs.length; i++) {
		const civName = nameArr[i];
		if (!civName) {
			continue;
		}
		const civ = civs[i];
		const targets = flagTargets(paths, civName);

		if (civ.flag_palette && civ.flag_palette[0] === -1) {
			// A vanilla flag was unlocked; copy it into every target.
			const vanillaFlag = path.join(config.files.vanillaCivs, `flag_${Number.parseInt(civ.flag_palette[1], 10)}.png`);
			for (const target of targets) {
				await scaffold.copyIfExists(vanillaFlag, target);
			}
			continue;
		}

		if (civ.customFlag && typeof civ.customFlagData === "string") {
			// A user-uploaded flag, delivered as a data URI.
			const encoded = civ.customFlagData.split(",")[1];
			if (!encoded) {
				logger.warn(`[${seed}] Custom flag for civ ${i} is malformed; skipping`);
				continue;
			}
			const buffer = Buffer.from(encoded, "base64");
			await Promise.all(targets.map((target) => fs.writeFile(target, buffer)));
			continue;
		}

		const palette = civ.flag_palette || [];
		const seedPalette = [[colours[palette[0]], colours[palette[1]], colours[palette[2]], colours[palette[3]], colours[palette[4]]], palette[5], palette[6]];
		await icons.drawFlag(seedPalette, palette[7] - 1, targets, config.dirs.symbols);
	}
}

/**
 * Shared tail of both generation modes: strings, icons, tech trees, the native
 * .dat rewrite, and packaging.
 */
async function finishMod(seed, modData, { withUi }) {
	const paths = modPaths(seed);

	if (withUi) {
		logger.info(`[${seed}] Writing strings`);
		modStrings.interperateLanguage(paths.dataJson, paths.moddedStrings);

		logger.info(`[${seed}] Copying strings to other locales`);
		await scaffold.copyLanguages(seed);

		logger.info(`[${seed}] Adding voice files`);
		await scaffold.copyVoices(seed, modData.language || []);

		logger.info(`[${seed}] Writing unit icons`);
		await writeUnitIcons(seed, modData.techtree || []);

		logger.info(`[${seed}] Writing civilizations and tech trees`);
		createCivilizationsJson(paths.dataJson, paths.civilizationsJson);
		createTechtreeJson.createTechtreeJson(paths.dataJson, paths.civTechTreesJson);

		logger.info(`[${seed}] Writing AI files`);
		makeai.createAI(paths.dataJson, paths.aiDir);
	}

	await writeDatFile(seed);

	logger.info(`[${seed}] Zipping mod`);
	const archive = await scaffold.zipModFolder(seed, withUi);
	logger.info(`[${seed}] Completed generation`);
	return archive;
}

/**
 * Generates a fully random mod.
 * @param {string} seed validated identifier, also used to seed generation
 */
async function buildRandomMod(seed, { randomCivs, modifiers }) {
	const paths = modPaths(seed);
	const rng = createRng(seed);

	logger.info(`[${seed}] Creating mod folder`);
	await scaffold.createModFolder(seed, randomCivs);

	if (randomCivs) {
		logger.info(`[${seed}] Generating civ icons`);
		await icons.generateFlags(paths.civFlags, paths.techtreeButtons, config.dirs.symbols, rng);
		await scaffold.copyTechtreeButtons(seed);
	}

	logger.info(`[${seed}] Generating data json`);
	makejson.createJson(paths.dataJson, String(randomCivs), modifiers, rng);

	const modData = JSON.parse(await fs.readFile(paths.dataJson, "utf8"));
	return finishMod(seed, modData, { withUi: randomCivs });
}

/**
 * Generates a mod from user-authored civilization presets.
 * @param {string} seed validated identifier
 * @param {object} modData the assembled mod data document
 * @param {Array} civs the raw presets, used for flag rendering
 */
async function buildPresetMod(seed, modData, civs) {
	const paths = modPaths(seed);

	logger.info(`[${seed}] Creating mod folder`);
	await scaffold.createModFolder(seed, true);

	logger.info(`[${seed}] Writing civ flags`);
	await writeCivFlags(seed, civs);
	await scaffold.copyTechtreeButtons(seed);

	await fs.writeFile(paths.dataJson, JSON.stringify(modData, null, 2));

	return finishMod(seed, modData, { withUi: true });
}

module.exports = {
	PLURAL_FLAG_CIVS,
	flagFileName,
	flagTargets,
	writeUnitIcons,
	writeDatFile,
	writeCivFlags,
	finishMod,
	buildRandomMod,
	buildPresetMod,
};
