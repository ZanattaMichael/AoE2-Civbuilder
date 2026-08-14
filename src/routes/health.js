"use strict";

const express = require("express");
const fs = require("fs");

const config = require("../config");
const { healthRateLimiter } = require("../middleware/rate-limit");

const router = express.Router();

/**
 * Liveness and readiness probes.
 *
 * Readiness checks that the assets and native binary the mod pipeline depends
 * on are present, so a misconfigured container fails fast instead of at the
 * first user request.
 *
 * Those checks touch the filesystem, and the endpoint is unauthenticated, so
 * the result is cached for a few seconds and the router carries its own
 * generous rate limit. A probe every few seconds is unaffected; a flood cannot
 * turn the endpoint into a filesystem amplifier.
 */

const READINESS_CACHE_MS = Number.parseInt(process.env.READINESS_CACHE_MS || "5000", 10);

let cached = null;

function readiness(now = Date.now()) {
	if (cached && now - cached.at < READINESS_CACHE_MS) {
		return cached.value;
	}

	const checks = {
		vanillaDat: fs.existsSync(config.files.vanillaDat),
		createDataMod: fs.existsSync(config.files.createDataMod),
		draftsDir: fs.existsSync(config.dirs.drafts),
		requestedModsDir: fs.existsSync(config.dirs.requestedMods),
	};

	const value = { ready: Object.values(checks).every(Boolean), checks };
	cached = { at: now, value };
	return value;
}

/** Drops the cached readiness result. Used by tests. */
function resetReadinessCache() {
	cached = null;
}

// Attached per route, not via router.use: this router is mounted at the base
// path, so router-level middleware would apply the probe limit to every
// request in the application.
router.get("/healthz", healthRateLimiter, (req, res) => {
	res.json({ status: "ok", uptime: process.uptime() });
});

router.get("/readyz", healthRateLimiter, (req, res) => {
	const { ready, checks } = readiness();
	res.status(ready ? 200 : 503).json({ status: ready ? "ready" : "not-ready", checks });
});

module.exports = router;
module.exports.readiness = readiness;
module.exports.resetReadinessCache = resetReadinessCache;
