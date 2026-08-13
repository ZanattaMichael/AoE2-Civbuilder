"use strict";

const globals = require("globals");
const prettier = require("eslint-config-prettier");

/**
 * Flat ESLint config.
 *
 * The rule set is deliberately close to "recommended" plus a few correctness
 * rules that matter for this codebase. The legacy files under public/js and the
 * large generated data modules are linted with a looser set so the config can be
 * adopted now rather than after a rewrite.
 */
module.exports = [
	{
		ignores: ["node_modules/**", "coverage/**", "modding/**", "public/aoe2techtree/js/svg.min.js", "misc/**", "drafts/**"],
	},
	{
		files: ["**/*.js"],
		languageOptions: {
			ecmaVersion: 2023,
			sourceType: "commonjs",
			globals: { ...globals.node },
		},
		linterOptions: {
			reportUnusedDisableDirectives: true,
		},
		rules: {
			"no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrors: "none" }],
			"no-undef": "error",
			"no-var": "error",
			"prefer-const": "error",
			eqeqeq: ["error", "smart"],
			"no-console": "off",
			"no-throw-literal": "error",
			"no-return-await": "error",
			"require-atomic-updates": "warn",
			"no-implicit-globals": "error",
		},
	},
	{
		// Server-side sources are held to the full rule set.
		files: ["src/**/*.js"],
		rules: {
			"no-unused-vars": ["error", { argsIgnorePattern: "^_|^next$", caughtErrors: "none" }],
		},
	},
	{
		// Vitest's API is ESM-only, so test files use import syntax even though
		// the modules they exercise are CommonJS.
		files: ["tests/**/*.js"],
		languageOptions: {
			sourceType: "module",
			globals: { ...globals.node },
		},
		rules: {
			"no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrors: "none" }],
		},
	},
	{
		// Browser code: pre-existing style, loaded via script tags with implicit
		// globals shared across files.
		files: ["public/**/*.js"],
		languageOptions: {
			sourceType: "script",
			globals: { ...globals.browser, ...globals.node, io: "readonly", axios: "readonly", SVG: "readonly" },
		},
		rules: {
			"no-var": "off",
			"prefer-const": "off",
			eqeqeq: "off",
			"no-unused-vars": "off",
			"no-undef": "off",
			"no-implicit-globals": "off",
		},
	},
	{
		// Generation modules carry large literal data tables and legacy style.
		files: ["process_mod/**/*.js"],
		rules: {
			"no-var": "off",
			"prefer-const": "off",
			eqeqeq: "off",
			"no-unused-vars": "warn",
		},
	},
	prettier,
];
