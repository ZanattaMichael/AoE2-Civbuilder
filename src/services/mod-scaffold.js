"use strict";

const fs = require("fs/promises");
const fsSync = require("fs");
const path = require("path");

const archiver = require("archiver");

const config = require("../config");
const logger = require("../logger");
const { modPaths, resolveWithin } = require("./paths");

/**
 * Creates the on-disk skeleton of a generated mod.
 *
 * This replaces process_mod/createModFolder.sh, copyLanguages.sh,
 * copyVoices.sh and zipModFolder.sh. Those scripts interpolated unquoted
 * request data into shell words; expressing the same work as filesystem calls
 * removes the shell from the pipeline entirely rather than trying to escape
 * one's way out of the problem.
 */

const LOCALES = ["br", "de", "es", "fr", "hi", "it", "jp", "ko", "ms", "mx", "ru", "tr", "tw", "vi", "zh"];
const STRING_FILE = "key-value-modded-strings-utf8.txt";

async function mkdirp(dir) {
	await fs.mkdir(dir, { recursive: true });
}

async function copyIfExists(src, dest) {
	try {
		await fs.copyFile(src, dest);
	} catch (err) {
		if (err.code === "ENOENT") {
			logger.warn(`Skipping missing source file: ${src}`);
			return false;
		}
		throw err;
	}
	return true;
}

async function copyDirContents(srcDir, destDir) {
	try {
		await mkdirp(destDir);
		await fs.cp(srcDir, destDir, { recursive: true });
	} catch (err) {
		if (err.code === "ENOENT") {
			logger.warn(`Skipping missing source directory: ${srcDir}`);
			return false;
		}
		throw err;
	}
	return true;
}

function dataModInfo(seed) {
	return {
		Author: "Krakenmeister",
		Description: "Created at www.krakenmeister.com/civdrafter. Replaces existing civilizations with entirely overhauled ones, created randomly or through a multiplayer drafting process",
		Title: `Custom Civilizations Mod [ID]=${seed}`,
	};
}

function uiModInfo(seed) {
	return {
		Author: "Krakenmeister",
		Description: "Text and images mod to accompany data mod of the same ID",
		Title: `Custom Civilizations UI [ID]=${seed}`,
	};
}

/**
 * Builds the directory tree for a mod.
 * @param {string} seed validated mod identifier
 * @param {boolean} withUi whether to also scaffold the accompanying UI mod
 */
async function createModFolder(seed, withUi) {
	const paths = modPaths(seed);
	const thumbnail = path.join(config.dirs.public, "img", "thumbnail.jpg");

	// --- Data mod ---
	await mkdirp(paths.dataDir);
	await fs.writeFile(path.join(paths.dataDir, "info.json"), JSON.stringify(dataModInfo(seed)));
	await copyIfExists(thumbnail, path.join(paths.dataDir, "thumbnail.jpg"));

	const dataCommon = path.join(paths.dataDir, "resources", "_common");
	await mkdirp(path.join(dataCommon, "dat"));
	await copyIfExists(config.files.vanillaDat, path.join(dataCommon, "dat", "empires2_x2_p1.dat"));

	if (withUi) {
		await mkdirp(paths.dataTechtreeIcons);
		await mkdirp(path.join(dataCommon, "wpfg", "resources", "civ_emblems"));
		await mkdirp(path.join(dataCommon, "wpfg", "resources", "uniticons"));
	}

	if (!withUi) {
		return paths;
	}

	// --- UI mod ---
	await mkdirp(paths.uiDir);
	await fs.writeFile(path.join(paths.uiDir, "info.json"), JSON.stringify(uiModInfo(seed)));
	await copyIfExists(thumbnail, path.join(paths.uiDir, "thumbnail.jpg"));

	await mkdirp(paths.aiDir);
	await mkdirp(paths.sounds);
	await mkdirp(paths.unitIcons);
	await mkdirp(paths.uiTechtreeIcons);
	await copyDirContents(path.join(config.dirs.public, "img", "civ_emblems"), path.join(paths.uiResources, "_common", "wpfg", "resources", "civ_emblems"));

	for (const locale of [...LOCALES, "en"]) {
		await mkdirp(path.join(paths.uiResources, locale, "strings", "key-value"));
	}
	// The strings file must exist before modStrings appends to it.
	await fs.writeFile(paths.moddedStrings, "");

	await mkdirp(paths.techtreeButtons);
	await mkdirp(paths.civFlags);

	return paths;
}

/** Fans the generated English strings file out to every other locale. */
async function copyLanguages(seed) {
	const paths = modPaths(seed);
	const source = paths.moddedStrings;

	for (const locale of LOCALES) {
		const destDir = path.join(paths.uiResources, locale, "strings", "key-value");
		await mkdirp(destDir);
		await copyIfExists(source, path.join(destDir, STRING_FILE));
	}
}

/** Copies the villager voice sets for each language actually used by the mod. */
async function copyVoices(seed, languageIds) {
	const paths = modPaths(seed);
	const unique = [...new Set(languageIds)].filter((id) => Number.isInteger(id) && id >= 0);

	for (const id of unique) {
		// id is coerced to a validated integer, so it cannot traverse.
		const srcDir = path.join(config.files.voiceFiles, String(id));
		await copyDirContents(srcDir, paths.sounds);
	}
}

/** Copies the rendered tech tree buttons into the UI mod's resource tree. */
async function copyTechtreeButtons(seed) {
	const paths = modPaths(seed);
	await copyDirContents(paths.techtreeButtons, paths.uiTechtreeIcons);
}

/**
 * Packages selected entries of a directory into a zip.
 *
 * Both the source and the destination are re-confined to the generated-mods
 * root before any filesystem call. Callers already pass paths built by
 * paths.modPaths() from a validated seed, so this is defence in depth — and it
 * keeps the guarantee local to the code that touches the disk rather than
 * spread across the call chain.
 */
function zipDirectory(sourceDir, outFile, entries) {
	const root = config.dirs.requestedMods;
	const safeSourceDir = resolveWithin(root, sourceDir);
	const safeOutFile = resolveWithin(root, outFile);

	return new Promise((resolve, reject) => {
		const output = fsSync.createWriteStream(safeOutFile);
		const archive = archiver("zip", { zlib: { level: 9 } });

		output.on("close", resolve);
		output.on("error", reject);
		archive.on("error", reject);
		archive.on("warning", (err) => {
			if (err.code === "ENOENT") {
				logger.warn(`archiver warning: ${err.message}`);
			} else {
				reject(err);
			}
		});

		archive.pipe(output);
		for (const entry of entries) {
			// Entry names are fixed literals or seed-derived, but each is still
			// confined before it reaches the filesystem.
			const full = resolveWithin(safeSourceDir, entry);
			if (!fsSync.existsSync(full)) {
				continue;
			}
			if (fsSync.statSync(full).isDirectory()) {
				archive.directory(full, entry);
			} else {
				archive.file(full, { name: entry });
			}
		}
		archive.finalize();
	});
}

/**
 * Packages the mod into the nested archive layout the game expects, then
 * removes the working directory.
 */
async function zipModFolder(seed, withUi) {
	const paths = modPaths(seed);

	await fs.rm(paths.archive, { force: true });

	const dataZip = path.join(paths.root, `${seed}-data.zip`);
	await zipDirectory(paths.dataDir, dataZip, ["resources"]);

	const outerEntries = [`${seed}-data.zip`];

	if (withUi) {
		const uiZip = path.join(paths.root, `${seed}-ui.zip`);
		await zipDirectory(paths.uiDir, uiZip, ["resources", "widgetui"]);
		outerEntries.push(`${seed}-ui.zip`);
	}

	// The thumbnail sits alongside the inner archives in the outer zip.
	const thumbnailSource = withUi ? path.join(paths.uiDir, "thumbnail.jpg") : path.join(paths.dataDir, "thumbnail.jpg");
	const thumbnailDest = path.join(paths.root, "thumbnail.jpg");
	if (await copyIfExists(thumbnailSource, thumbnailDest)) {
		outerEntries.push("thumbnail.jpg");
	}

	await zipDirectory(paths.root, paths.archive, outerEntries);

	// The archive lives one level above the working tree, so the entire tree can
	// go once packaging succeeds.
	await fs.rm(paths.root, { recursive: true, force: true });

	return paths.archive;
}

module.exports = {
	LOCALES,
	createModFolder,
	copyLanguages,
	copyVoices,
	copyTechtreeButtons,
	zipModFolder,
	zipDirectory,
	mkdirp,
	copyIfExists,
	copyDirContents,
};
