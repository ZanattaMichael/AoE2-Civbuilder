"use strict";

const rateLimit = require("express-rate-limit");

const config = require("../config");

/**
 * Rate limiting.
 *
 * Mod generation runs a native .dat rewrite over a ~10MB file and then zips the
 * result, so an unthrottled endpoint is a free denial-of-service. The two
 * limiters separate that expensive work from ordinary page traffic.
 */

const modRateLimiter = rateLimit({
	windowMs: config.limits.modRateWindowMs,
	max: config.limits.modRateMax,
	standardHeaders: true,
	legacyHeaders: false,
	message: { error: "Too many mod generation requests, please try again later" },
	// Opt-in bypass for test runs; see config.limits.rateLimitDisabled.
	skip: () => config.limits.rateLimitDisabled,
});

const generalRateLimiter = rateLimit({
	windowMs: config.limits.generalRateWindowMs,
	max: config.limits.generalRateMax,
	standardHeaders: true,
	legacyHeaders: false,
	message: { error: "Too many requests, please try again later" },
	skip: () => config.limits.rateLimitDisabled,
});

/**
 * Health probes get their own generous limit. They must stay available to an
 * orchestrator polling every few seconds, but they are unauthenticated and do
 * touch the filesystem, so they are not left entirely unbounded.
 */
const healthRateLimiter = rateLimit({
	windowMs: 60 * 1000,
	max: Number.parseInt(process.env.HEALTH_RATE_MAX || "600", 10),
	standardHeaders: true,
	legacyHeaders: false,
	message: { error: "Too many health check requests" },
	skip: () => config.limits.rateLimitDisabled,
});

module.exports = { modRateLimiter, generalRateLimiter, healthRateLimiter };
