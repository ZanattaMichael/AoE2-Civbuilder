"use strict";

const path = require("path");

/**
 * Central, environment-driven configuration.
 *
 * Every path the application touches is derived from APP_DIR so that nothing
 * depends on the directory the process happens to be started from. The previous
 * implementation hardcoded an absolute path and called process.chdir() on every
 * request, which made concurrent requests race against each other.
 */

function requireDir(value, name) {
	if (!value || typeof value !== "string") {
		throw new Error(`Configuration error: ${name} must be a non-empty path`);
	}
	return path.resolve(value);
}

function parsePort(value) {
	const port = Number.parseInt(value, 10);
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new Error(`Configuration error: PORT must be an integer between 1 and 65535, got "${value}"`);
	}
	return port;
}

function parseOrigins(value) {
	if (!value) {
		return [];
	}
	return value
		.split(",")
		.map((origin) => origin.trim())
		.filter(Boolean);
}

const appDir = requireDir(process.env.APP_DIR || path.join(__dirname, ".."), "APP_DIR");

// A cookie secret is mandatory outside of development: signed cookies are the
// only thing preventing a client from claiming an arbitrary draft seat.
const nodeEnv = process.env.NODE_ENV || "development";
const cookieSecret = process.env.COOKIE_SECRET;
if (!cookieSecret && nodeEnv === "production") {
	throw new Error("Configuration error: COOKIE_SECRET is required when NODE_ENV=production");
}

const config = {
	nodeEnv,
	isProduction: nodeEnv === "production",
	isTest: nodeEnv === "test",

	port: parsePort(process.env.PORT || "4000"),
	host: process.env.HOST || "0.0.0.0",

	// Public URL the site is served from, used to build draft invite links.
	publicUrl: (process.env.PUBLIC_URL || "http://localhost:4000/civbuilder").replace(/\/+$/, ""),
	// Path prefix the router is mounted under.
	basePath: process.env.BASE_PATH || "/civbuilder",

	cookieSecret: cookieSecret || "insecure-development-secret-do-not-use-in-production",

	// Comma-separated list of allowed browser origins. Empty means same-origin only.
	corsOrigins: parseOrigins(process.env.CORS_ORIGINS),

	dirs: {
		app: appDir,
		public: path.join(appDir, "public"),
		drafts: path.join(appDir, "drafts"),
		requestedMods: path.join(appDir, "modding", "requested_mods"),
		vanillaFiles: path.join(appDir, "public", "vanillaFiles"),
		symbols: path.join(appDir, "public", "img", "symbols"),
		unitIcons: path.join(appDir, "public", "img", "uniticons"),
		processMod: path.join(appDir, "process_mod"),
		views: path.join(appDir, "public", "pug"),
	},

	files: {
		// The C++ binary that rewrites the game's .dat file.
		createDataMod: process.env.CREATE_DATA_MOD_BIN || path.join(appDir, "modding", "build", "create-data-mod"),
		vanillaDat: path.join(appDir, "public", "vanillaFiles", "empires2_x2_p1.dat"),
		voiceFiles: path.join(appDir, "public", "vanillaFiles", "voiceFiles"),
		vanillaCivs: path.join(appDir, "public", "vanillaFiles", "vanillaCivs"),
	},

	limits: {
		// Body size accepted on mod-generation endpoints.
		bodyLimit: process.env.BODY_LIMIT || "20mb",
		// Mod generation is expensive (native .dat rewrite + zip), so it is rate
		// limited far more aggressively than ordinary page loads.
		modRateWindowMs: Number.parseInt(process.env.MOD_RATE_WINDOW_MS || "900000", 10),
		modRateMax: Number.parseInt(process.env.MOD_RATE_MAX || "10", 10),
		generalRateWindowMs: Number.parseInt(process.env.GENERAL_RATE_WINDOW_MS || "900000", 10),
		generalRateMax: Number.parseInt(process.env.GENERAL_RATE_MAX || "300", 10),
		// Hard ceiling on how long an external command may run.
		commandTimeoutMs: Number.parseInt(process.env.COMMAND_TIMEOUT_MS || "300000", 10),
	},

	logLevel: process.env.LOG_LEVEL || (nodeEnv === "test" ? "silent" : "info"),
};

module.exports = config;
