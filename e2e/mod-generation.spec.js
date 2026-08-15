"use strict";

const fs = require("fs");
const { test, expect, BASE } = require("./helpers");

/**
 * Mod generation, end to end.
 *
 * These drive the real pipeline: scaffolding, seeded generation, the native
 * binary invoked through execFile, packaging, and the download response. Only
 * the C++ .dat rewriter is a stub (see e2e/fixture-server.js).
 */

test.describe("random mod generation", () => {
	test("generates and downloads a data-only mod", async ({ page }) => {
		await page.goto(`${BASE}/`);

		const [download] = await Promise.all([
			page.waitForEvent("download", { timeout: 60000 }),
			page.evaluate(async (base) => {
				// Submit the same form the page builds for the random flow.
				const form = document.createElement("form");
				form.method = "post";
				form.action = `${base}/random`;
				for (const [name, value] of Object.entries({
					seed: "e2erandom01",
					civs: "false",
					modifiers: "{}",
				})) {
					const input = document.createElement("input");
					input.type = "hidden";
					input.name = name;
					input.value = value;
					form.appendChild(input);
				}
				document.body.appendChild(form);
				form.submit();
			}, BASE),
		]);

		expect(download.suggestedFilename()).toBe("e2erandom01.zip");

		const filePath = await download.path();
		const contents = fs.readFileSync(filePath);
		expect(contents.length).toBeGreaterThan(0);
		// A zip's local file header magic.
		expect(contents.subarray(0, 2).toString("latin1")).toBe("PK");
	});

	test("the archive contains the nested data mod and thumbnail", async ({ request }) => {
		const response = await request.post(`${BASE}/random`, {
			form: { seed: "structure01", civs: "false", modifiers: "{}" },
		});
		expect(response.status()).toBe(200);

		const archive = await response.body();
		// Zip stores entry names uncompressed in its headers, so the packaging
		// layout can be asserted without a zip reader.
		const asText = archive.toString("latin1");
		expect(asText).toContain("structure01-data.zip");
		expect(asText).toContain("thumbnail.jpg");
	});

	test("different seeds produce different mods", async ({ request }) => {
		const a = await request.post(`${BASE}/random`, { form: { seed: "seedaaa", civs: "false", modifiers: "{}" } });
		const b = await request.post(`${BASE}/random`, { form: { seed: "seedbbb", civs: "false", modifiers: "{}" } });

		expect(a.status()).toBe(200);
		expect(b.status()).toBe(200);
		// Seeded generation means the civilizations differ, so the archives do.
		// (Reproducibility for a *fixed* seed is asserted deterministically in
		// tests/rng.test.js; archive bytes embed mtimes and cannot show it.)
		expect(Buffer.compare(await a.body(), await b.body())).not.toBe(0);
	});

	test("rejects an injection payload in the seed", async ({ request }) => {
		const response = await request.post(`${BASE}/random`, {
			form: { seed: "abc; touch /tmp/e2e-pwned", civs: "false", modifiers: "{}" },
		});

		expect(response.status()).toBe(400);
		expect((await response.json()).error).toMatch(/Invalid seed/);
		expect(fs.existsSync("/tmp/e2e-pwned"), "no command should have run").toBe(false);
	});

	test("rejects malformed modifiers without a 500", async ({ request }) => {
		const response = await request.post(`${BASE}/random`, {
			form: { seed: "badmods01", civs: "false", modifiers: "{not json" },
		});
		expect(response.status()).toBe(400);
	});
});

test.describe("mod download", () => {
	test("refuses a traversal payload in draftID", async ({ request }) => {
		for (const draftID of ["../../etc/passwd", "/etc/passwd", "a/../../b"]) {
			const response = await request.post(`${BASE}/download`, { form: { draftID } });
			expect(response.status(), draftID).toBe(400);
		}
	});

	test("returns 404 for an archive that does not exist", async ({ request }) => {
		const response = await request.post(`${BASE}/download`, { form: { draftID: "999999999999999" } });
		expect(response.status()).toBe(404);
	});
});
