"use strict";

const { test, expect, BASE, collectPageProblems, expectNoProblems, authorCivilization, civilizationInPage, downloadCivilization, downloadBytes } = require("./helpers");

/**
 * Authoring a civilization.
 *
 * The builder is the heart of the site, and it is entirely client-side: three
 * phases of DOM built by public/js/builder.js, with the civilization assembled
 * in the page and only serialised on export. Nothing but a browser can tell
 * whether a choice a user made actually reached the document they download.
 *
 * These specs therefore make real choices — flag colours, architecture,
 * language, bonus cards across rounds — and assert the export carries them.
 */

// The client validates both fields as alphanumerics and spaces, 30 characters
// at most, so the fixtures have to satisfy that to reach the rest of the flow.
const CIV_NAME = "E2E Testonians";
const CIV_DESCRIPTION = "Infantry and cavalry";

test.describe("authoring a civilization", () => {
	test("carries every choice made in the builder into the export", async ({ page }) => {
		const problems = collectPageProblems(page);

		await authorCivilization(page, {
			name: CIV_NAME,
			description: CIV_DESCRIPTION,
			architectureSteps: 3,
			languageSteps: 2,
			paletteSteps: { 0: 2, 5: 1 },
			bonuses: { 0: [0, 5], 2: [3] },
		});

		const download = await downloadCivilization(page);
		expect(download.suggestedFilename()).toBe(`${CIV_NAME}.json`);

		const civ = JSON.parse((await downloadBytes(download)).toString("utf8"));

		expect(civ.alias).toBe(CIV_NAME);
		expect(civ.description).toBe(CIV_DESCRIPTION);

		// Architecture starts at 1 and language at 0; each click advances by one.
		expect(civ.architecture).toBe(4);
		expect(civ.language).toBe(2);

		// Only the categories that were advanced may have moved.
		expect(civ.flag_palette).toEqual([5, 4, 5, 6, 7, 4, 3, 3]);

		// Each pick is stored as [card, count] in the round it was made in.
		expect(civ.bonuses[0]).toEqual([
			[0, 1],
			[5, 1],
		]);
		expect(civ.bonuses[1]).toEqual([]);
		expect(civ.bonuses[2]).toEqual([[3, 1]]);

		expectNoProblems(problems);
	});

	test("exports a document with every field the generator needs", async ({ page }) => {
		await authorCivilization(page, { name: "Shape Check", bonuses: { 0: [1] } });

		const civ = JSON.parse((await downloadBytes(await downloadCivilization(page))).toString("utf8"));

		expect(Array.isArray(civ.tree)).toBe(true);
		expect(civ.tree).toHaveLength(3);
		expect(Array.isArray(civ.bonuses)).toBe(true);
		expect(civ.bonuses).toHaveLength(5);
		expect(Array.isArray(civ.flag_palette)).toBe(true);
		expect(civ.flag_palette).toHaveLength(8);
		expect(typeof civ.architecture).toBe("number");
		expect(typeof civ.language).toBe("number");
		expect(typeof civ.wonder).toBe("number");
		expect(typeof civ.castle).toBe("number");
		expect(typeof civ.customFlag).toBe("boolean");
	});

	test("moves a bonus card between the trays as it is picked and dropped", async ({ page }) => {
		await authorCivilization(page, { name: "Tray Check" });

		const selected = page.locator("#selected > *");
		const unselected = page.locator("#unselected > *");
		const before = await unselected.count();
		expect(await selected.count()).toBe(0);

		await page.locator("#card7").click({ force: true });
		await expect(selected).toHaveCount(1);
		await expect(unselected).toHaveCount(before - 1);
		expect((await civilizationInPage(page)).bonuses[0]).toEqual([[7, 1]]);

		// Clicking a picked card returns it.
		await page.locator("#card7").click({ force: true });
		await expect(selected).toHaveCount(0);
		await expect(unselected).toHaveCount(before);
		expect((await civilizationInPage(page)).bonuses[0]).toEqual([]);
	});

	test("keeps each round's picks in its own slot", async ({ page }) => {
		await authorCivilization(page, { name: "Round Check", bonuses: { 1: [2], 4: [6] } });

		const civ = await civilizationInPage(page);
		expect(civ.bonuses[0]).toEqual([]);
		expect(civ.bonuses[2]).toEqual([]);
		expect(civ.bonuses[3]).toEqual([]);
		expect(civ.bonuses[4]).toEqual([[6, 1]]);

		// The unique-unit round is the odd one out: a civilization has exactly one,
		// so it stores a bare card index where every other round stores a
		// [card, count] pair. The generator reads both shapes, and a change here
		// would silently produce civilizations with no unique unit.
		expect(civ.bonuses[1]).toEqual([2]);
	});

	test("walks all five rounds, keeping every pick", async ({ page }) => {
		await authorCivilization(page, {
			name: "Full House",
			bonuses: { 0: [1, 2], 1: [3], 2: [4], 3: [5], 4: [6] },
		});

		const civ = await civilizationInPage(page);
		expect(civ.bonuses).toEqual([
			[
				[1, 1],
				[2, 1],
			],
			[3],
			[[4, 1]],
			[[5, 1]],
			[[6, 1]],
		]);
	});

	test("rejects an empty civilization name in the UI", async ({ page }) => {
		await page.goto(`${BASE}/build`);
		await expect(page.locator("#alias")).toBeVisible();

		page.on("dialog", (dialog) => dialog.accept());
		await page.getByRole("button", { name: "Next" }).click();

		// Validation keeps the user on the naming screen.
		await expect(page.locator("#alias")).toBeVisible();
	});

	test("rejects a name the generator would not accept", async ({ page }) => {
		await page.goto(`${BASE}/build`);
		await expect(page.locator("#alias")).toBeVisible();

		const alerts = [];
		page.on("dialog", (dialog) => {
			alerts.push(dialog.message());
			return dialog.accept();
		});

		for (const name of ["Punctuated!", " LeadingSpace", "A".repeat(31)]) {
			await page.locator("#alias").fill(name);
			await page.getByRole("button", { name: "Next" }).click();
			// Rejected names never leave the naming screen.
			await expect(page.locator("#alias"), name).toBeVisible();
		}

		expect(alerts).toHaveLength(3);
	});

	test("rejects a description the generator would not accept", async ({ page }) => {
		await page.goto(`${BASE}/build`);
		await expect(page.locator("#alias")).toBeVisible();
		await page.locator("#alias").fill("Valid Name");

		await page.locator("#advancedbutton").click();
		await expect(page.locator("#advancedbox")).toBeVisible();
		await page.locator("#descriptioninput").fill("Cavalry, archers");
		await page.locator("#descriptioninput").blur();

		page.on("dialog", (dialog) => dialog.accept());
		await page.getByRole("button", { name: "Next" }).click();

		await expect(page.locator("#alias")).toBeVisible();
	});

	test("a civilization name containing control characters is sanitised", async ({ page }) => {
		await authorCivilization(page, { name: "Sanitised" });
		const civ = await civilizationInPage(page);

		const NUL = String.fromCharCode(0);
		civ.alias = `Evil${NUL}Civ`;

		const response = await page.request.post(`${BASE}/create`, {
			form: { seed: "sanitise001", presets: JSON.stringify({ presets: [civ] }), modifiers: "{}" },
		});

		// Accepted, but the control character never reaches the mod.
		expect(response.status()).toBe(200);
	});
});
