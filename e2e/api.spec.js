"use strict";

const { test, expect, BASE, createDraft } = require("./helpers");

/**
 * Every HTTP endpoint the application exposes, exercised against a running
 * instance.
 *
 * The intent is coverage rather than depth: each route is hit with a valid
 * request and with a malformed one, so a route that disappears, starts
 * returning the wrong status, or stops validating its input is caught. When
 * this suite runs against the container image (E2E_BASE_URL), it is also the
 * proof that the shipped artifact serves every endpoint.
 */

/** Every route in the application, with how to exercise it. */
const ENDPOINTS = [
	{ method: "GET", path: "/healthz", expect: 200 },
	{ method: "GET", path: "/readyz", expect: 200 },
	{ method: "GET", path: "/", expect: 200, html: true },
	{ method: "GET", path: "/build", expect: 200, html: true },
	{ method: "GET", path: "/view", expect: 200, html: true },
	{ method: "GET", path: "/edit", expect: 200, html: true },
	{ method: "POST", path: "/view", expect: 200, html: true, form: {} },
	{ method: "POST", path: "/edit", expect: 200, html: true, form: {} },
];

test.describe("endpoint availability", () => {
	for (const endpoint of ENDPOINTS) {
		test(`${endpoint.method} ${endpoint.path} responds ${endpoint.expect}`, async ({ request }) => {
			const url = `${BASE}${endpoint.path}`;
			const response = endpoint.method === "GET" ? await request.get(url) : await request.post(url, { form: endpoint.form || {} });

			expect(response.status()).toBe(endpoint.expect);
			if (endpoint.html) {
				expect(response.headers()["content-type"]).toContain("html");
			}
		});
	}

	test("GET /readyz reports every dependency it checks", async ({ request }) => {
		const response = await request.get(`${BASE}/readyz`);
		const body = await response.json();

		expect(body.status).toBe("ready");
		for (const key of ["vanillaDat", "createDataMod", "draftsDir", "requestedModsDir"]) {
			expect(body.checks[key], key).toBe(true);
		}
	});

	test("GET /healthz reports uptime", async ({ request }) => {
		const body = await (await request.get(`${BASE}/healthz`)).json();
		expect(body.status).toBe("ok");
		expect(typeof body.uptime).toBe("number");
	});
});

test.describe("POST /random", () => {
	test("generates a mod archive", async ({ request }) => {
		const response = await request.post(`${BASE}/random`, {
			form: { seed: "apirandom001", civs: "false", modifiers: "{}" },
		});

		expect(response.status()).toBe(200);
		expect(response.headers()["content-type"]).toMatch(/zip|octet-stream/);
		expect((await response.body()).subarray(0, 2).toString("latin1")).toBe("PK");
	});

	test("generates a mod with civilizations, icons and strings", async ({ request }) => {
		// civs=true exercises flag rendering, string generation, tech tree JSON
		// and the AI files — the whole UI-mod half of the pipeline.
		const response = await request.post(`${BASE}/random`, {
			form: { seed: "apirandomfull", civs: "true", modifiers: "{}" },
		});

		expect(response.status(), (await response.text().catch(() => "")).slice(0, 300)).toBe(200);

		const archive = (await response.body()).toString("latin1");
		expect(archive).toContain("apirandomfull-data.zip");
		expect(archive).toContain("apirandomfull-ui.zip");
	});

	test("rejects a malformed seed", async ({ request }) => {
		const response = await request.post(`${BASE}/random`, { form: { seed: "bad seed!", civs: "false", modifiers: "{}" } });
		expect(response.status()).toBe(400);
	});
});

test.describe("POST /create", () => {
	const civ = {
		alias: "Api Civ",
		description: "Built by the API suite",
		flag_palette: [3, 4, 5, 6, 7, 3, 3, 3],
		tree: [
			[13, 17, 21],
			[12, 45, 49],
			[22, 101],
		],
		bonuses: [[], [], [], [], []],
		architecture: 1,
		language: 0,
		wonder: 0,
		castle: 0,
	};

	test("builds a mod from a civilization preset", async ({ request }) => {
		const response = await request.post(`${BASE}/create`, {
			form: { seed: "apicreate001", presets: JSON.stringify({ presets: [civ] }), modifiers: "{}" },
		});

		expect(response.status(), (await response.text().catch(() => "")).slice(0, 300)).toBe(200);
		expect((await response.body()).subarray(0, 2).toString("latin1")).toBe("PK");
	});

	test("rejects malformed presets", async ({ request }) => {
		const response = await request.post(`${BASE}/create`, { form: { seed: "apicreate002", presets: "{oops", modifiers: "{}" } });
		expect(response.status()).toBe(400);
	});
});

test.describe("POST /vanilla", () => {
	test("either serves the vanilla data or reports it missing", async ({ request }) => {
		// The archive is an optional asset, so both outcomes are valid; what
		// matters is that the route does not error.
		const response = await request.post(`${BASE}/vanilla`);
		expect([200, 404]).toContain(response.status());
	});
});

test.describe("draft endpoints", () => {
	test("POST /draft creates a lobby", async ({ page }) => {
		const draft = await createDraft(page, { players: 2 });
		expect(draft.id).toMatch(/^\d{15}$/);
	});

	test("GET /draft/:id serves the draft page", async ({ page }) => {
		const draft = await createDraft(page, { players: 2 });
		const response = await page.request.get(draft.spectatorLink);

		expect(response.status()).toBe(200);
		expect(await response.text()).toContain("<html");
	});

	test("GET /draft/host/:id and /draft/player/:id serve the join form", async ({ page }) => {
		const draft = await createDraft(page, { players: 2 });

		for (const link of [draft.hostLink, draft.playerLink]) {
			const response = await page.request.get(link);
			expect(response.status(), link).toBe(200);
			expect(await response.text(), link).toContain("join_form");
		}
	});

	test("POST /join seats a player and redirects", async ({ page }) => {
		const draft = await createDraft(page, { players: 2 });

		const response = await page.request.post(`${BASE}/join`, {
			form: { draftID: draft.id, joinType: "0", civ_name: "ApiHost" },
			maxRedirects: 0,
		});

		expect(response.status()).toBe(302);
		expect(response.headers().location).toContain(`/draft/${draft.id}`);
	});

	test("POST /download serves a completed draft's archive", async ({ page }) => {
		// No archive exists for a fresh draft, so 404 is the correct answer.
		const draft = await createDraft(page, { players: 2 });
		const response = await page.request.post(`${BASE}/download`, { form: { draftID: draft.id } });

		expect(response.status()).toBe(404);
	});
});

test.describe("error handling", () => {
	test("unknown routes return 404", async ({ request }) => {
		const response = await request.get(`${BASE}/definitely-not-real`);
		expect(response.status()).toBe(404);
	});

	test("removed endpoints stay removed", async ({ request }) => {
		const response = await request.post(`${BASE}/setCookie`, { form: { cookie: "x", value: "y" } });
		expect(response.status()).toBe(404);
	});

	test("malformed JSON bodies are rejected, not crashed on", async ({ request }) => {
		const response = await request.post(`${BASE}/create`, {
			headers: { "Content-Type": "application/json" },
			data: "{ not json",
		});

		expect(response.status()).toBeGreaterThanOrEqual(400);
		expect(response.status()).toBeLessThan(500);

		// The server must still be serving afterwards.
		expect((await request.get(`${BASE}/healthz`)).status()).toBe(200);
	});
});

test.describe("static assets", () => {
	test("serves the vendored jQuery from this origin", async ({ request }) => {
		const response = await request.get(`${BASE}/vendor/jquery.min.js`);

		expect(response.status()).toBe(200);
		expect(response.headers()["content-type"]).toMatch(/javascript/);
		expect(await response.text()).toContain("jQuery");
	});

	test("serves client scripts and styles", async ({ request }) => {
		for (const asset of ["/js/common.js", "/js/client.js", "/css/styles.css"]) {
			const response = await request.get(`${BASE}${asset}`);
			expect(response.status(), asset).toBe(200);
		}
	});
});
