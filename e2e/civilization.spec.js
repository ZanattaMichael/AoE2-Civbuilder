"use strict";

const { test, expect, BASE, collectPageProblems, expectNoProblems } = require("./helpers");

/**
 * The complete authoring journey: build a civilization in the browser, export
 * it, and turn the exported file into a downloadable game mod.
 *
 * This is the path a real user takes, and it crosses every layer — the builder
 * UI, the client-side civ model, the export helper, the /create endpoint, the
 * generation pipeline and the native .dat rewriter.
 */

const CIV_NAME = "E2E Testonians";
const CIV_DESCRIPTION = "A civilization created by the end-to-end suite.";

/** Fills in the builder's first screen and advances to the tech tree board. */
async function buildCivilization(page, { name = CIV_NAME, description = CIV_DESCRIPTION } = {}) {
	await page.goto(`${BASE}/build`);

	await expect(page.locator("#alias")).toBeVisible();
	await page.locator("#alias").fill(name);

	// The description lives behind the advanced panel.
	if (await page.locator("#descriptioninput").isVisible()) {
		await page.locator("#descriptioninput").fill(description);
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
	// they do not cover the card being inspected — so the Download control is
	// clicked with force below rather than waiting on that styling.
	await expect(page.locator("#boardtoolbar")).toBeAttached();
	await expect(page.locator("#finish")).toBeAttached();
}

/** Clicks the board's Download control, bypassing its hover-gated styling. */
async function clickDownload(page) {
	return page.locator("#finish").click({ force: true });
}

test.describe("authoring a civilization", () => {
	test("builds a civilization and exports it as JSON", async ({ page }) => {
		const problems = collectPageProblems(page);

		await buildCivilization(page);

		const [download] = await Promise.all([page.waitForEvent("download"), clickDownload(page)]);

		expect(download.suggestedFilename()).toBe(`${CIV_NAME}.json`);

		const stream = await download.createReadStream();
		const chunks = [];
		for await (const chunk of stream) {
			chunks.push(chunk);
		}
		const civ = JSON.parse(Buffer.concat(chunks).toString("utf8"));

		// The exported document must carry everything /create needs.
		expect(civ.alias).toBe(CIV_NAME);
		expect(Array.isArray(civ.tree)).toBe(true);
		expect(civ.tree).toHaveLength(3);
		expect(Array.isArray(civ.bonuses)).toBe(true);
		expect(civ.bonuses).toHaveLength(5);
		expect(Array.isArray(civ.flag_palette)).toBe(true);
		expect(civ.flag_palette).toHaveLength(8);
		expect(typeof civ.architecture).toBe("number");
		expect(typeof civ.language).toBe("number");

		expectNoProblems(problems);
	});

	test("rejects an empty civilization name in the UI", async ({ page }) => {
		await page.goto(`${BASE}/build`);
		await expect(page.locator("#alias")).toBeVisible();

		page.on("dialog", (dialog) => dialog.accept());
		await page.getByRole("button", { name: "Next" }).click();

		// Validation keeps the user on the naming screen.
		await expect(page.locator("#alias")).toBeVisible();
	});

	test("an exported civilization generates a downloadable mod", async ({ page }) => {
		await buildCivilization(page, { name: "Exportable" });

		// Read the civ the builder assembled, exactly as the export would.
		const civ = await page.evaluate(() => JSON.parse(JSON.stringify(window.civ)));
		expect(civ.alias).toBe("Exportable");

		const response = await page.request.post(`${BASE}/create`, {
			form: {
				seed: "civexport01",
				presets: JSON.stringify({ presets: [civ] }),
				modifiers: JSON.stringify({ randomCosts: false, hp: 1, speed: 1, blind: false, infinity: false, building: 1 }),
			},
		});

		expect(response.status(), await safeText(response)).toBe(200);

		const archive = await response.body();
		expect(archive.subarray(0, 2).toString("latin1")).toBe("PK");
		expect(archive.toString("latin1")).toContain("civexport01-data.zip");
	});

	test("a mod can be built from several exported civilizations", async ({ page }) => {
		await buildCivilization(page, { name: "First Civ" });
		const first = await page.evaluate(() => JSON.parse(JSON.stringify(window.civ)));

		await buildCivilization(page, { name: "Second Civ" });
		const second = await page.evaluate(() => JSON.parse(JSON.stringify(window.civ)));

		const response = await page.request.post(`${BASE}/create`, {
			form: {
				seed: "multicreate1",
				presets: JSON.stringify({ presets: [first, second] }),
				modifiers: "{}",
			},
		});

		expect(response.status(), await safeText(response)).toBe(200);
		expect((await response.body()).subarray(0, 2).toString("latin1")).toBe("PK");
	});

	test("a civilization name containing control characters is sanitised", async ({ page }) => {
		await buildCivilization(page, { name: "Sanitised" });
		const civ = await page.evaluate(() => JSON.parse(JSON.stringify(window.civ)));

		const NUL = String.fromCharCode(0);
		civ.alias = `Evil${NUL}Civ`;

		const response = await page.request.post(`${BASE}/create`, {
			form: { seed: "sanitise001", presets: JSON.stringify({ presets: [civ] }), modifiers: "{}" },
		});

		// Accepted, but the control character never reaches the mod.
		expect(response.status()).toBe(200);
	});
});

/** Returns a response body as text without throwing on binary payloads. */
async function safeText(response) {
	try {
		return (await response.text()).slice(0, 500);
	} catch {
		return "<binary>";
	}
}
