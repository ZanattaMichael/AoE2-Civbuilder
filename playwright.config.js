"use strict";

const { defineConfig, devices } = require("@playwright/test");

const PORT = process.env.E2E_PORT || "4599";
const BASE_URL = `http://127.0.0.1:${PORT}`;

/**
 * End-to-end configuration.
 *
 * The suite drives a real browser against a real server process (see
 * e2e/fixture-server.js), so it exercises the client-side JavaScript, the
 * socket.io protocol and the HTTP layer together — the seams the unit and
 * integration suites cannot reach.
 */
module.exports = defineConfig({
	testDir: "./e2e",
	testMatch: /.*\.spec\.js/,

	// Draft flows coordinate several browser contexts; give them room without
	// letting a hang stall the run.
	timeout: 60000,
	expect: { timeout: 10000 },

	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	workers: 1,

	reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],

	use: {
		baseURL: BASE_URL,
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
		video: "retain-on-failure",
		actionTimeout: 15000,
	},

	projects: [
		{
			name: "chromium",
			use: {
				...devices["Desktop Chrome"],
				// Set CHROMIUM_PATH to use a browser already present on the machine
				// (for example a preinstalled Chromium in a container image) instead
				// of the build Playwright would download for its own version.
				launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
			},
		},
	],

	webServer: {
		command: `node e2e/fixture-server.js`,
		url: `${BASE_URL}/civbuilder/healthz`,
		reuseExistingServer: !process.env.CI,
		timeout: 60000,
		env: {
			PORT,
			NODE_ENV: "development",
			COOKIE_SECRET: "e2e-fixture-secret",
			LOG_LEVEL: process.env.E2E_LOG_LEVEL || "warn",
		},
		stdout: "pipe",
		stderr: "pipe",
	},
});
