"use strict";

const { test, expect, BASE, authorCivilization, downloadCivilization, downloadBytes } = require("./helpers");
const zip = require("./zip");

/**
 * Combining civilizations into a downloadable mod.
 *
 * This is the journey the site exists for: author civilizations, then feed the
 * exported documents back in to get a mod you can install. It runs entirely
 * through the real UI — the multi-file picker behind "Create Mod", the client's
 * compatibility check, the modifier form, and the browser download the server's
 * response triggers.
 *
 * The assertions open the archive rather than stopping at its magic bytes,
 * because "responded with a zip" and "built a mod containing the civilizations
 * that went in" are very different claims. The names land in the modded strings
 * file, and each civilization contributes its own AI files.
 */

/** Opens the "Create Mod" picker on the home page and returns its file input. */
async function openCombinePicker(page) {
	await page.goto(`${BASE}/`);
	await page.locator("#combineButton").click();
	const input = page.locator("#viewCiv");
	await expect(input).toBeAttached();
	return input;
}

/**
 * Feeds exported civilizations to the picker and captures the mod the browser
 * downloads in response.
 */
async function combineAndDownload(page, civilizations) {
	const input = await openCombinePicker(page);

	const [download] = await Promise.all([
		page.waitForEvent("download", { timeout: 120000 }),
		input.setInputFiles(
			civilizations.map((civ) => ({
				name: `${civ.name}.json`,
				mimeType: "application/json",
				buffer: civ.buffer,
			}))
		),
	]);

	return download;
}

/** Splits a generated mod into its nested data and UI archives. */
function openMod(archive) {
	const names = zip.listFileNames(archive);
	const dataName = names.find((name) => name.endsWith("-data.zip"));
	const uiName = names.find((name) => name.endsWith("-ui.zip"));

	expect(dataName, `no data mod among ${names.join(", ")}`).toBeDefined();
	expect(uiName, `no UI mod among ${names.join(", ")}`).toBeDefined();

	return {
		names,
		data: zip.readFile(archive, dataName),
		ui: zip.readFile(archive, uiName),
	};
}

/** Reads the English modded strings, where civilization names are written. */
function moddedStrings(ui) {
	return zip.readMatching(ui, /^resources\/en\/strings\/key-value\/.*\.txt$/).toString("utf8");
}

/** Authors a civilization in the browser and returns its exported bytes. */
async function exportCivilization(page, options) {
	await authorCivilization(page, options);
	const download = await downloadCivilization(page);
	return { name: options.name, buffer: await downloadBytes(download) };
}

test.describe("combining civilizations", () => {
	test("combines two authored civilizations into one downloadable mod", async ({ page }) => {
		const first = await exportCivilization(page, { name: "Alphalanders", bonuses: { 0: [0] } });
		const second = await exportCivilization(page, { name: "Betamancers", bonuses: { 0: [5] } });

		const download = await combineAndDownload(page, [first, second]);
		expect(download.suggestedFilename()).toMatch(/^[A-Za-z0-9]+\.zip$/);

		const archive = await downloadBytes(download);
		const mod = openMod(archive);

		// The packaging the game expects.
		expect(mod.names).toContain("thumbnail.jpg");

		// Both civilizations must actually be in the mod, not just one of them.
		const strings = moddedStrings(mod.ui);
		expect(strings).toContain(`"${first.name}"`);
		expect(strings).toContain(`"${second.name}"`);

		// Each civilization contributes its own AI, so the count tracks the input.
		const aiFiles = zip.listFileNames(mod.ui).filter((name) => name.endsWith(".per"));
		expect(aiFiles).toHaveLength(2);
		expect(aiFiles.some((name) => name.includes(first.name))).toBe(true);
		expect(aiFiles.some((name) => name.includes(second.name))).toBe(true);

		// The data mod carries the rewritten game data.
		expect(zip.listFileNames(mod.data)).toContain("resources/_common/dat/empires2_x2_p1.dat");
	});

	test("a single civilization combines on its own", async ({ page }) => {
		const only = await exportCivilization(page, { name: "Soloists", bonuses: { 0: [2] } });

		const archive = await downloadBytes(await combineAndDownload(page, [only]));
		const mod = openMod(archive);

		expect(moddedStrings(mod.ui)).toContain(`"${only.name}"`);
		expect(zip.listFileNames(mod.ui).filter((name) => name.endsWith(".per"))).toHaveLength(1);
	});

	test("scales to more civilizations than the pair case", async ({ page }) => {
		const names = ["Gammadines", "Deltavians", "Epsilonites"];
		const civilizations = [];
		for (const name of names) {
			civilizations.push(await exportCivilization(page, { name, bonuses: { 0: [1] } }));
		}

		const archive = await downloadBytes(await combineAndDownload(page, civilizations));
		const mod = openMod(archive);

		const strings = moddedStrings(mod.ui);
		for (const name of names) {
			expect(strings, `${name} missing from the mod`).toContain(`"${name}"`);
		}
		expect(zip.listFileNames(mod.ui).filter((name) => name.endsWith(".per"))).toHaveLength(names.length);
	});

	test("applies the modifiers chosen on the form", async ({ page }) => {
		const civ = await exportCivilization(page, { name: "Modified", bonuses: { 0: [0] } });

		const input = await openCombinePicker(page);

		await page.locator("#randomCostInput").check();
		await page.locator("#blindInput").check();
		await page.locator("#healthValue").fill("2");
		await page.locator("#speedValue").fill("1.5");
		await page.locator("#buildingValue").fill("0.5");

		// The client reads the form when the files are chosen, so the request the
		// page issues is the proof the values were carried.
		const [request, download] = await Promise.all([
			page.waitForRequest((candidate) => candidate.url().endsWith("/create") && candidate.method() === "POST"),
			page.waitForEvent("download", { timeout: 120000 }),
			input.setInputFiles([{ name: `${civ.name}.json`, mimeType: "application/json", buffer: civ.buffer }]),
		]);

		const submitted = new URLSearchParams(request.postData());
		const modifiers = JSON.parse(submitted.get("modifiers"));

		expect(modifiers.randomCosts).toBe(true);
		expect(modifiers.blind).toBe(true);
		expect(modifiers.hp).toBe(2);
		expect(modifiers.speed).toBe(1.5);
		expect(modifiers.building).toBe(0.5);

		// And the mod still builds with them applied.
		expect(moddedStrings(openMod(await downloadBytes(download)).ui)).toContain(`"${civ.name}"`);
	});

	test("sends every chosen civilization to the server, not just the first", async ({ page }) => {
		const first = await exportCivilization(page, { name: "Sentinel One", bonuses: { 0: [0] } });
		const second = await exportCivilization(page, { name: "Sentinel Two", bonuses: { 0: [3] } });

		const input = await openCombinePicker(page);

		const [request] = await Promise.all([
			page.waitForRequest((candidate) => candidate.url().endsWith("/create") && candidate.method() === "POST"),
			page.waitForEvent("download", { timeout: 120000 }),
			input.setInputFiles([first, second].map((civ) => ({ name: `${civ.name}.json`, mimeType: "application/json", buffer: civ.buffer }))),
		]);

		const presets = JSON.parse(new URLSearchParams(request.postData()).get("presets"));
		expect(presets.presets).toHaveLength(2);
		expect(presets.presets.map((preset) => preset.alias)).toEqual([first.name, second.name]);
	});
});

/**
 * The base-game presets are part of the real game assets, which the fixture
 * does not ship — it stands up a temporary APP_DIR with placeholder art. These
 * therefore run against the container image, where the assets are real, and
 * report themselves skipped elsewhere rather than failing for the wrong reason.
 */
test.describe("vanilla civilizations", () => {
	/** Downloads the base-game presets, skipping the test if they are absent. */
	async function downloadVanilla(page) {
		const probe = await page.request.post(`${BASE}/vanilla`);
		test.skip(probe.status() === 404, "vanilla game assets are not present in this environment");
		expect(probe.status()).toBe(200);

		await page.goto(`${BASE}/`);
		await page.locator("#combineButton").click();
		const [download] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), page.locator("#vanillaDownload").click()]);
		return downloadBytes(download);
	}

	test("downloads the base-game presets", async ({ page }) => {
		const archive = await downloadVanilla(page);

		const names = zip.listFileNames(archive);
		expect(names.length).toBeGreaterThan(0);
		expect(names.every((name) => name.endsWith(".json"))).toBe(true);

		// Each one must be a civilization the combine flow can actually accept.
		const first = JSON.parse(zip.readFile(archive, names[0]).toString("utf8"));
		expect(typeof first.alias).toBe("string");
		expect(first.tree).toHaveLength(3);
		expect(first.bonuses).toHaveLength(5);
	});

	test("a base-game civilization combines with an authored one", async ({ page }) => {
		const vanillaArchive = await downloadVanilla(page);
		const firstVanilla = zip.listFileNames(vanillaArchive)[0];
		const vanilla = {
			name: firstVanilla.replace(/\.json$/, ""),
			buffer: zip.readFile(vanillaArchive, firstVanilla),
		};

		const authored = await exportCivilization(page, { name: "Newcomers", bonuses: { 0: [4] } });

		const archive = await downloadBytes(await combineAndDownload(page, [vanilla, authored]));
		const mod = openMod(archive);

		const strings = moddedStrings(mod.ui);
		expect(strings).toContain(`"${authored.name}"`);
		expect(strings).toContain(`"${JSON.parse(vanilla.buffer.toString("utf8")).alias}"`);
	});
});
