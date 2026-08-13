"use strict";

const { defineConfig } = require("vitest/config");

module.exports = defineConfig({
	test: {
		environment: "node",
		include: ["tests/**/*.test.js"],
		setupFiles: ["tests/setup.js"],
		// The mod pipeline touches the filesystem; keep suites in separate
		// processes so their temporary directories cannot collide.
		pool: "forks",
		testTimeout: 20000,
		coverage: {
			provider: "v8",
			reportsDirectory: "coverage",
			reporter: ["text", "lcov"],
			include: ["src/**/*.js", "process_mod/rng.js"],
			// Large legacy data modules and the canvas-bound icon renderer are out
			// of scope for the initial coverage gate.
			exclude: ["src/index.js"],
			thresholds: {
				lines: 60,
				functions: 60,
				branches: 70,
				statements: 60,
			},
		},
	},
});
