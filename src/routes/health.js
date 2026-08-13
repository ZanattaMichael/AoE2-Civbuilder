"use strict";

const express = require("express");
const fs = require("fs");

const config = require("../config");

const router = express.Router();

/**
 * Liveness and readiness probes. Readiness additionally checks that the assets
 * and native binary the mod pipeline depends on are actually present, so a
 * misconfigured container fails fast instead of at the first user request.
 */

router.get("/healthz", (req, res) => {
	res.json({ status: "ok", uptime: process.uptime() });
});

router.get("/readyz", (req, res) => {
	const checks = {
		vanillaDat: fs.existsSync(config.files.vanillaDat),
		createDataMod: fs.existsSync(config.files.createDataMod),
		draftsDir: fs.existsSync(config.dirs.drafts),
		requestedModsDir: fs.existsSync(config.dirs.requestedMods),
	};

	const ready = Object.values(checks).every(Boolean);
	res.status(ready ? 200 : 503).json({ status: ready ? "ready" : "not-ready", checks });
});

module.exports = router;
