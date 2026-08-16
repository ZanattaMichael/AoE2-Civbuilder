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
 * The modifier panel above "Create Mod".
 *
 * Six settings ride along with every generated mod, and the "Civilizations"
 * dropdown changes what the button does entirely: on `custom` it opens the file
 * picker and posts the uploaded presets to /create, while `random` and
 * `vanilla` skip the picker and post to /random instead. Getting any of this
 * wrong is silent — the mod still downloads, just not the one that was asked
 * for — so these assert on the request the page issues.
 */
test.describe("modifiers", () => {
	/** The modifier payload the page attached to a generation request. */
	function modifiersIn(request) {
		return JSON.parse(new URLSearchParams(request.postData()).get("modifiers"));
	}

	function generationRequest(page, route) {
		return page.waitForRequest((candidate) => candidate.url().endsWith(route) && candidate.method() === "POST");
	}

	test("carries every modifier, including x256 Ages", async ({ page }) => {
		const civ = await exportCivilization(page, { name: "Modified", bonuses: { 0: [0] } });

		const input = await openCombinePicker(page);

		await page.locator("#randomCostInput").check();
		await page.locator("#blindInput").check();
		await page.locator("#infinityInput").check();
		await page.locator("#healthValue").fill("2");
		await page.locator("#speedValue").fill("1.5");
		await page.locator("#buildingValue").fill("0.5");

		// The client reads the form when the files are chosen, so the request the
		// page issues is the proof the values were carried.
		const [request, download] = await Promise.all([
			generationRequest(page, "/create"),
			page.waitForEvent("download", { timeout: 120000 }),
			input.setInputFiles([{ name: `${civ.name}.json`, mimeType: "application/json", buffer: civ.buffer }]),
		]);

		expect(modifiersIn(request)).toEqual({
			randomCosts: true,
			blind: true,
			infinity: true,
			hp: 2,
			speed: 1.5,
			building: 0.5,
		});

		// And the mod still builds with them applied.
		expect(moddedStrings(openMod(await downloadBytes(download)).ui)).toContain(`"${civ.name}"`);
	});

	test("defaults to leaving the game unmodified", async ({ page }) => {
		const civ = await exportCivilization(page, { name: "Untouched", bonuses: { 0: [0] } });
		const input = await openCombinePicker(page);

		const [request] = await Promise.all([
			generationRequest(page, "/create"),
			page.waitForEvent("download", { timeout: 120000 }),
			input.setInputFiles([{ name: `${civ.name}.json`, mimeType: "application/json", buffer: civ.buffer }]),
		]);

		// The multipliers are neutral at 1 and the toggles off, so an untouched
		// panel must not quietly alter the game.
		expect(modifiersIn(request)).toEqual({
			randomCosts: false,
			blind: false,
			infinity: false,
			hp: 1,
			speed: 1,
			building: 1,
		});
	});

	test("the sliders drive the values that are sent", async ({ page }) => {
		const civ = await exportCivilization(page, { name: "Slid", bonuses: { 0: [0] } });
		const input = await openCombinePicker(page);

		// Each slider is two-way bound to the number beside it; moving the slider
		// is how most users set these at all.
		await page.locator("#healthRange").fill("3.5");
		await page.locator("#speedRange").fill("0.25");
		await page.locator("#buildingRange").fill("7");

		await expect(page.locator("#healthValue")).toHaveValue("3.5");
		await expect(page.locator("#speedValue")).toHaveValue("0.25");
		await expect(page.locator("#buildingValue")).toHaveValue("7");

		const [request] = await Promise.all([
			generationRequest(page, "/create"),
			page.waitForEvent("download", { timeout: 120000 }),
			input.setInputFiles([{ name: `${civ.name}.json`, mimeType: "application/json", buffer: civ.buffer }]),
		]);

		const modifiers = modifiersIn(request);
		expect(modifiers.hp).toBe(3.5);
		expect(modifiers.speed).toBe(0.25);
		expect(modifiers.building).toBe(7);
	});

	test("clamps values typed past their limits", async ({ page }) => {
		await openCombinePicker(page);

		// The number fields accept more than the slider's range and clamp on
		// change, each to its own ceiling and floor.
		for (const [field, typed, clamped] of [
			["#healthValue", "999", "100"],
			["#healthValue", "-5", "0"],
			["#speedValue", "999", "20"],
			["#speedValue", "-5", "0"],
			["#buildingValue", "999", "100"],
			["#buildingValue", "0", "0.001"],
		]) {
			await page.locator(field).fill(typed);
			await page.locator(field).blur();
			await expect(page.locator(field), `${field} typed ${typed}`).toHaveValue(clamped);
		}
	});

	test("Civilizations: Random generates without asking for files", async ({ page }) => {
		await openCombinePicker(page);
		await page.locator("#baseInput").selectOption("random");
		await page.locator("#infinityInput").check();

		// On random the picker never opens: clicking Create Mod posts straight to
		// the random generator instead.
		const [request, download] = await Promise.all([generationRequest(page, "/random"), page.waitForEvent("download", { timeout: 120000 }), page.locator("#viewCiv").click()]);

		const submitted = new URLSearchParams(request.postData());
		expect(submitted.get("civs")).toBe("true");
		expect(modifiersIn(request).infinity).toBe(true);

		expect(zip.listFileNames(await downloadBytes(download))).toContain("thumbnail.jpg");
	});

	test("Civilizations: Vanilla applies modifiers to the base game", async ({ page }) => {
		await openCombinePicker(page);
		await page.locator("#baseInput").selectOption("vanilla");
		await page.locator("#healthValue").fill("4");

		const [request, download] = await Promise.all([generationRequest(page, "/random"), page.waitForEvent("download", { timeout: 120000 }), page.locator("#viewCiv").click()]);

		const submitted = new URLSearchParams(request.postData());
		// Vanilla means the base game's own civilizations, so nothing is generated.
		expect(submitted.get("civs")).toBe("false");
		expect(modifiersIn(request).hp).toBe(4);

		expect(zip.listFileNames(await downloadBytes(download))).toContain("thumbnail.jpg");
	});

	test("Civilizations: Custom is what opens the file picker", async ({ page }) => {
		const input = await openCombinePicker(page);
		await expect(page.locator("#baseInput")).toHaveValue("custom");

		const civ = await exportCivilization(page, { name: "Chosen", bonuses: { 0: [0] } });
		const picker = await openCombinePicker(page);

		const [request] = await Promise.all([
			generationRequest(page, "/create"),
			page.waitForEvent("download", { timeout: 120000 }),
			picker.setInputFiles([{ name: `${civ.name}.json`, mimeType: "application/json", buffer: civ.buffer }]),
		]);

		expect(new URLSearchParams(request.postData()).get("presets")).toContain(civ.name);
		expect(input).toBeDefined();
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

	/** Unpacks every preset in the downloaded archive into combine-ready files. */
	function presetsIn(archive) {
		return zip.listFileNames(archive).map((name) => ({
			name: name.replace(/\.json$/, ""),
			buffer: zip.readFile(archive, name),
		}));
	}

	test("downloads the base-game presets", async ({ page }) => {
		const archive = await downloadVanilla(page);

		const names = zip.listFileNames(archive);
		expect(names.length).toBeGreaterThan(0);
		expect(names.every((name) => name.endsWith(".json"))).toBe(true);

		// Every one must be a civilization the combine flow can actually accept —
		// a single unparseable entry breaks that user's mod with no clear message.
		for (const preset of presetsIn(archive)) {
			const civ = JSON.parse(preset.buffer.toString("utf8"));
			expect(typeof civ.alias, preset.name).toBe("string");
			expect(civ.tree, preset.name).toHaveLength(3);
			expect(civ.bonuses, preset.name).toHaveLength(5);
		}
	});

	/**
	 * The headline journey for the base game: Get Vanilla Civs, then hand the
	 * whole set straight back to Create Mod.
	 *
	 * The archive holds exactly 50 presets, which is exactly the client's
	 * `numCivs` ceiling — `checkCompatibility` aborts above it, so this run sits
	 * on the boundary and would start failing the moment a civilization is added
	 * to the game without the cap being raised.
	 */
	test("combines the entire base game into one mod", async ({ page }) => {
		test.slow();

		const archive = await downloadVanilla(page);
		const presets = presetsIn(archive);
		const aliases = presets.map((preset) => JSON.parse(preset.buffer.toString("utf8")).alias);

		expect(presets.length, "the whole set should be within the client's cap").toBeLessThanOrEqual(50);

		const mod = openMod(await downloadBytes(await combineAndDownload(page, presets)));

		const strings = moddedStrings(mod.ui);
		for (const alias of aliases) {
			expect(strings, `${alias} missing from the mod`).toContain(`"${alias}"`);
		}

		// One AI per civilization, so nothing was silently dropped along the way.
		expect(zip.listFileNames(mod.ui).filter((name) => name.endsWith(".per"))).toHaveLength(presets.length);
	});

	test("combines the whole base game with civilizations of your own", async ({ page }) => {
		test.slow();

		const authored = await exportCivilization(page, { name: "Newcomers", bonuses: { 0: [4] } });

		const archive = await downloadVanilla(page);
		// The cap counts every file handed to the picker, so authored
		// civilizations displace base-game ones rather than adding to them.
		const presets = presetsIn(archive).slice(0, 49);
		const aliases = presets.map((preset) => JSON.parse(preset.buffer.toString("utf8")).alias);

		const mod = openMod(await downloadBytes(await combineAndDownload(page, [...presets, authored])));

		const strings = moddedStrings(mod.ui);
		expect(strings).toContain(`"${authored.name}"`);
		for (const alias of aliases) {
			expect(strings, `${alias} missing from the mod`).toContain(`"${alias}"`);
		}
		expect(zip.listFileNames(mod.ui).filter((name) => name.endsWith(".per"))).toHaveLength(presets.length + 1);
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
