"use strict";

const base = require("@playwright/test");
const { expect } = base;

const BASE = "/civbuilder";

/**
 * A test object that blocks third-party origins.
 *
 * The site references Google Fonts from its stylesheet. Letting the browser
 * reach out makes every run depend on the network — slow where it is reachable
 * and slower still where it is not, since each request has to time out. Tests
 * should exercise this application, not a CDN.
 */
const EXTERNAL_PATTERN = /fonts\.(googleapis|gstatic)\.com/;

const test = base.test.extend({
	context: async ({ context }, use) => {
		await context.route(EXTERNAL_PATTERN, (route) => route.abort());
		await use(context);
	},
});

/**
 * Creates an additional browser context for a second player.
 *
 * Contexts made directly from `browser` bypass the fixture above, so each one
 * has to opt in to the same third-party blocking or it stalls on font
 * requests.
 */
async function newPlayerContext(browser) {
	const context = await browser.newContext();
	await context.route(EXTERNAL_PATTERN, (route) => route.abort());
	return context;
}

/**
 * Google Fonts is requested from public/css/styles.css and draft.html. It is
 * allowed by the CSP but unreachable from a sandboxed CI runner, and the site
 * degrades gracefully without it, so it is not treated as a failure.
 */
const EXTERNAL_ORIGINS = ["fonts.googleapis.com", "fonts.gstatic.com"];

function isExternal(url) {
	return EXTERNAL_ORIGINS.some((origin) => url.includes(origin));
}

/**
 * The fixture ships placeholder art rather than the real ~245MB public/img
 * tree, so a missing image is a property of the fixture, not a regression.
 * Code assets and API routes are held to a zero-failure standard because that
 * is where regressions actually appear.
 */
function isFixtureArt(url) {
	return /\/img\/.+\.(png|jpg|jpeg|gif|webp|svg)$/i.test(url);
}

/**
 * Records console errors, page errors and failed requests for a page.
 *
 * Returns an object whose arrays fill as the page runs; assert on them after
 * the interaction under test. CSP violations surface here as console errors,
 * which is what makes these specs catch a policy that blocks the site's own
 * scripts.
 */
function collectPageProblems(page, { ignoreMissingArt = true } = {}) {
	const problems = { consoleErrors: [], pageErrors: [], failedRequests: [], missingArt: [] };

	const skip = (url) => isExternal(url) || (ignoreMissingArt && isFixtureArt(url));

	page.on("console", (message) => {
		const url = (message.location() && message.location().url) || "";
		if (message.type() !== "error") {
			return;
		}
		// A resource 404 also emits a generic console error with the failing
		// request as its location; classify those alongside the response.
		if (skip(url)) {
			return;
		}
		problems.consoleErrors.push(message.text());
	});

	page.on("pageerror", (error) => problems.pageErrors.push(error.message));

	page.on("requestfailed", (request) => {
		const url = request.url();
		if (isExternal(url)) {
			return;
		}
		const detail = `${url} :: ${request.failure() ? request.failure().errorText : "unknown"}`;
		if (ignoreMissingArt && isFixtureArt(url)) {
			problems.missingArt.push(detail);
		} else {
			problems.failedRequests.push(detail);
		}
	});

	page.on("response", (response) => {
		const url = response.url();
		if (response.status() < 400 || isExternal(url)) {
			return;
		}
		const detail = `${url} :: HTTP ${response.status()}`;
		if (ignoreMissingArt && isFixtureArt(url)) {
			problems.missingArt.push(detail);
		} else {
			problems.failedRequests.push(detail);
		}
	});

	return problems;
}

/** Asserts a page loaded and ran without script errors or broken requests. */
function expectNoProblems(problems) {
	expect(problems.pageErrors, "uncaught page errors").toEqual([]);
	expect(problems.failedRequests, "failed requests").toEqual([]);
	expect(problems.consoleErrors, "console errors").toEqual([]);
}

/**
 * Creates a draft through the real form and returns its ID and invite links.
 */
async function createDraft(page, { players = 2, rounds = 3, currency = 100 } = {}) {
	const response = await page.request.post(`${BASE}/draft`, {
		form: {
			num_players: String(players),
			techtree_currency: String(currency),
			rounds: String(rounds),
			allowed_rarities: "true,true,true,true,true",
		},
	});
	expect(response.status()).toBe(200);

	const html = await response.text();
	const match = html.match(/draft\/player\/(\d+)/);
	expect(match, "draft links should contain a draft ID").not.toBeNull();
	const id = match[1];

	return {
		id,
		playerLink: `${BASE}/draft/player/${id}`,
		hostLink: `${BASE}/draft/host/${id}`,
		spectatorLink: `${BASE}/draft/${id}`,
	};
}

/**
 * Joins a draft as host or player through the join form, leaving the context
 * holding a seat cookie.
 */
async function joinDraft(page, link, name) {
	await page.goto(link);
	await page.locator("#join_form input[name='civ_name']").fill(name);
	await Promise.all([page.waitForURL(/\/draft\/\d+$/), page.locator("#join_form").evaluate((form) => form.requestSubmit())]);
}

/** Reads the seat the server assigned to this page's socket. */
async function seatOf(page) {
	return page.evaluate(() => window.clientSeat);
}

module.exports = {
	test,
	expect,
	BASE,
	newPlayerContext,
	collectPageProblems,
	expectNoProblems,
	createDraft,
	joinDraft,
	seatOf,
};
