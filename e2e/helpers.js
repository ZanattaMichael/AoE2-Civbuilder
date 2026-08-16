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
 * Chromium treats a plain-HTTP origin that is not loopback as untrustworthy and
 * logs an error for every HTTPS-only response header it therefore ignores. That
 * is a property of how the suite reaches the target — the container run talks to
 * the app by container name over HTTP — not a defect in the headers, which are
 * correct behind the TLS-terminating proxy the site is deployed behind.
 */
function isUntrustworthyOriginAdvisory(text) {
	return /header has been ignored, because the URL's origin was untrustworthy/.test(text);
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
		if (isUntrustworthyOriginAdvisory(message.text())) {
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
 * Authors a civilization through the builder UI.
 *
 * The builder runs in three phases — flag creator, tech tree, bonus board — and
 * this drives all of them, so the resulting civilization reflects real choices
 * rather than the defaults the page starts with. Every option is optional;
 * passing none still walks the full journey.
 *
 * `bonuses` is a map of round index to the card indices to pick in that round.
 * The board shows one round at a time, and rounds are reached with the arrows
 * beside the phase name, so picks are made round by round in order.
 */
async function authorCivilization(page, { name = "E2E Civ", description, architectureSteps = 0, languageSteps = 0, wonderSteps = 0, castleSteps = 0, paletteSteps = {}, bonuses = {} } = {}) {
	await page.goto(`${BASE}/build`);
	await expect(page.locator("#alias")).toBeVisible();
	await page.locator("#alias").fill(name);

	// The flag palette is eight categories, each a back/forward pair around a
	// label. Advancing a category cycles that slot's value.
	for (const [category, steps] of Object.entries(paletteSteps)) {
		for (let step = 0; step < steps; step++) {
			await page.locator("#pickGrid button.forwardbutton").nth(Number(category)).click();
		}
	}

	for (let step = 0; step < architectureSteps; step++) {
		await page.locator("#archbox button.forwardbutton").click();
	}

	// Description, language, wonder and castle live behind the advanced panel,
	// which starts collapsed — their controls exist in the DOM but are not
	// clickable until it is opened.
	if (description !== undefined || languageSteps > 0 || wonderSteps > 0 || castleSteps > 0) {
		await page.locator("#advancedbutton").click();
		await expect(page.locator("#advancedbox")).toBeVisible();

		if (description !== undefined) {
			await page.locator("#descriptioninput").fill(description);
			// The field commits on change, which blurring triggers.
			await page.locator("#descriptioninput").blur();
		}
		for (let step = 0; step < languageSteps; step++) {
			await page.locator("#langbox button.forwardbutton").click();
		}
		for (let step = 0; step < wonderSteps; step++) {
			await page.locator("#wonderbox button.forwardbutton").click();
		}
		for (let step = 0; step < castleSteps; step++) {
			await page.locator("#castlebox button.forwardbutton").click();
		}
	}

	await page.getByRole("button", { name: "Next" }).click();

	// Advancing opens the tech tree overlay, which hides the rest of the page
	// while it renders. It has no "finished rendering" signal and re-applies the
	// hiding as its data arrives, so let it settle before closing it.
	await expect(page.locator("#techtree")).toBeVisible();
	await page.waitForTimeout(1000);
	await page.locator("#done").click();

	// The board is back once its toolbar exists. The toolbar's buttons carry
	// visibility:hidden until the mouse leaves a bonus card — an affordance so
	// they do not cover the card being inspected — so the controls are clicked
	// with force rather than waiting on that styling.
	await expect(page.locator("#boardtoolbar")).toBeAttached();
	await expect(page.locator("#finish")).toBeAttached();

	const rounds = Object.keys(bonuses)
		.map(Number)
		.sort((a, b) => a - b);
	let currentRound = 0;
	for (const round of rounds) {
		while (currentRound < round) {
			await page.locator("#buttonright").click();
			currentRound++;
		}
		for (const card of bonuses[round]) {
			await page.locator(`#card${card}`).click({ force: true });
		}
	}
}

/** Reads the civilization the builder has assembled in the page. */
async function civilizationInPage(page) {
	return page.evaluate(() => JSON.parse(JSON.stringify(window.civ)));
}

/** Clicks the board's Download control, bypassing its hover-gated styling. */
async function downloadCivilization(page) {
	const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#finish").click({ force: true })]);
	return download;
}

/** Reads a download's bytes without depending on where Playwright staged it. */
async function downloadBytes(download) {
	const stream = await download.createReadStream();
	const chunks = [];
	for await (const chunk of stream) {
		chunks.push(chunk);
	}
	return Buffer.concat(chunks);
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
	authorCivilization,
	civilizationInPage,
	downloadCivilization,
	downloadBytes,
	createDraft,
	joinDraft,
	seatOf,
};
