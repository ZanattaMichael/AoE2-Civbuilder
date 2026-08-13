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
	// Disabled under test so integration tests are not order-dependent.
	skip: () => config.isTest,
});

const generalRateLimiter = rateLimit({
	windowMs: config.limits.generalRateWindowMs,
	max: config.limits.generalRateMax,
	standardHeaders: true,
	legacyHeaders: false,
	message: { error: "Too many requests, please try again later" },
	skip: () => config.isTest,
});

module.exports = { modRateLimiter, generalRateLimiter };
