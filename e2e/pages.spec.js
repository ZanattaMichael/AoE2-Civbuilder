"use strict";

const { test, expect, BASE, collectPageProblems, expectNoProblems } = require("./helpers");

/**
 * Page loading.
 *
 * These are the specs that would have caught the Content-Security-Policy
 * blocking the site's own jQuery: a policy of script-src 'self' silently kills
 * every page that loaded jQuery from a CDN, and nothing below the browser
 * notices.
 */

test.describe("static pages", () => {
	test("home page renders and its scripts run", async ({ page }) => {
		const problems = collectPageProblems(page);

		await page.goto(`${BASE}/`);

		await expect(page.locator("#title")).toHaveText("Civilization Builder");
		await expect(page.locator("#startBuild")).toBeVisible();
		await expect(page.locator("#combineButton")).toBeVisible();
		await expect(page.locator("#startDraft")).toBeVisible();

		expectNoProblems(problems);
	});

	test("jQuery is served from this origin, not a third party", async ({ page }) => {
		const scriptOrigins = [];
		page.on("response", (response) => {
			if (response.url().endsWith(".js")) {
				scriptOrigins.push(new URL(response.url()).origin);
			}
		});

		await page.goto(`${BASE}/`);
		await expect(page.locator("#startBuild")).toBeVisible();

		// jQuery must actually be present, or the pages silently do nothing.
		expect(await page.evaluate(() => typeof window.jQuery)).toBe("function");
		expect(await page.evaluate(() => window.jQuery.fn.jquery)).toMatch(/^3\./);

		const baseOrigin = new URL(page.url()).origin;
		expect(
			scriptOrigins.every((origin) => origin === baseOrigin),
			`script origins: ${scriptOrigins.join(", ")}`
		).toBe(true);
	});

	test("builder page builds its interface", async ({ page }) => {
		const problems = collectPageProblems(page);

		await page.goto(`${BASE}/build`);
		// The builder ships an empty <body> and constructs everything in
		// builder.js, so a working page is one where those elements appear.
		await expect(page.locator("#buildwrapper")).toBeVisible();
		await page.waitForLoadState("networkidle");

		expectNoProblems(problems);
	});

	test("navigation buttons move between sections", async ({ page }) => {
		await page.goto(`${BASE}/`);

		await page.locator("#help").click();
		await expect(page.locator("#instructionsbox")).toBeVisible();

		await page.locator("#home").click();
		await expect(page.locator("#startBuild")).toBeVisible();
	});

	test("start build navigates to the builder", async ({ page }) => {
		await page.goto(`${BASE}/`);
		await page.locator("#startBuild").click();
		await expect(page.locator("#page")).toBeVisible();
	});

	test("health and readiness endpoints respond", async ({ request }) => {
		const health = await request.get(`${BASE}/healthz`);
		expect(health.status()).toBe(200);
		expect((await health.json()).status).toBe("ok");

		const ready = await request.get(`${BASE}/readyz`);
		expect(ready.status()).toBe(200);
		expect((await ready.json()).checks.createDataMod).toBe(true);
	});

	test("unknown routes return 404 without a stack trace", async ({ request }) => {
		const response = await request.get(`${BASE}/no-such-page`);
		expect(response.status()).toBe(404);
		expect(await response.text()).not.toMatch(/node_modules|at Object|\/src\//);
	});
});

test.describe("security headers in the browser", () => {
	test("a strict CSP is served and not violated by the site's own assets", async ({ page }) => {
		const violations = [];
		page.on("console", (message) => {
			if (/Content Security Policy|Refused to (load|execute|apply)/i.test(message.text())) {
				violations.push(message.text());
			}
		});

		const response = await page.goto(`${BASE}/`);
		const csp = response.headers()["content-security-policy"];

		expect(csp).toContain("default-src 'self'");
		expect(csp).toContain("object-src 'none'");
		expect(csp).toContain("frame-ancestors 'none'");
		expect(response.headers()["x-content-type-options"]).toBe("nosniff");
		expect(response.headers()["x-powered-by"]).toBeUndefined();

		await page.waitForLoadState("networkidle");
		expect(violations, "the site's own assets must not violate its CSP").toEqual([]);
	});
});
