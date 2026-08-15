"use strict";

const express = require("express");
const fs = require("fs");

const config = require("../config");
const logger = require("../logger");
const { asyncHandler, BadRequestError, NotFoundError } = require("../errors");
const { assertSeed, parseJsonField, parseBoolean, assertArray, normalizeModifiers } = require("../validation");
const { modArchive } = require("../services/paths");
const modBuilder = require("../services/mod-builder");
const modData = require("../services/mod-data");
const { modRateLimiter } = require("../middleware/rate-limit");
const { nameArr } = require("../../process_mod/constants.js");

const router = express.Router();

/**
 * Mod generation and download.
 *
 * The `seed` in these bodies used to be interpolated into shell commands and
 * filesystem paths with no checking at all. It is now validated before any
 * other work happens.
 */

router.post(
	"/random",
	modRateLimiter,
	asyncHandler(async (req, res) => {
		const seed = assertSeed(req.body.seed);
		const randomCivs = parseBoolean(req.body.civs, true);
		const modifiers = normalizeModifiers(parseJsonField(req.body.modifiers || "{}", "modifiers"));

		const archive = await modBuilder.buildRandomMod(seed, { randomCivs, modifiers });
		res.download(archive, `${seed}.zip`);
	})
);

router.post(
	"/create",
	modRateLimiter,
	asyncHandler(async (req, res) => {
		const seed = assertSeed(req.body.seed);
		const modifiers = normalizeModifiers(parseJsonField(req.body.modifiers || "{}", "modifiers"));

		const rawPresets = parseJsonField(req.body.presets, "presets");
		const civs = assertArray(rawPresets && rawPresets.presets, "presets.presets", { maxLength: nameArr.length });
		if (civs.length === 0) {
			throw new BadRequestError("At least one civilization preset is required");
		}

		const data = modData.fromPresets(civs, modifiers);
		const archive = await modBuilder.buildPresetMod(seed, data, civs);
		res.download(archive, `${seed}.zip`);
	})
);

/** Downloads the archive produced for a completed draft. */
router.post(
	"/download",
	asyncHandler(async (req, res) => {
		const id = assertSeed(req.body.draftID, "draftID");
		const archive = modArchive(id);

		if (!fs.existsSync(archive)) {
			throw new NotFoundError("Mod archive not found");
		}
		res.download(archive, `${id}.zip`);
	})
);

router.post("/vanilla", (req, res) => {
	const archive = `${config.files.vanillaCivs}/VanillaJson.zip`;
	if (!fs.existsSync(archive)) {
		logger.warn(`Vanilla archive missing at ${archive}`);
		return res.status(404).type("text/plain").send("Vanilla data not available");
	}
	return res.download(archive, "VanillaJson.zip");
});

module.exports = router;
