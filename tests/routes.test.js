import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";

// The native .dat rewriter is replaced by a stub executable in tests/setup.js,
// so the generation pipeline below runs for real: scaffolding, seeded JSON
// generation, invoking the binary through execFile, and packaging.
import appModule from "../src/app.js";
import config from "../src/config.js";
import draftsStore from "../src/services/drafts.js";
import draftLogic from "../src/services/draft-logic.js";

function stubArchive(seed) {
	fs.mkdirSync(config.dirs.requestedMods, { recursive: true });
	const file = path.join(config.dirs.requestedMods, `${seed}.zip`);
	fs.writeFileSync(file, "PKstub");
	return file;
}

const app = appModule.createApp();
const base = config.basePath;

describe("health endpoints", () => {
	it("reports liveness", async () => {
		const res = await request(app).get(`${base}/healthz`);
		expect(res.status).toBe(200);
		expect(res.body.status).toBe("ok");
	});

	it("reports readiness with per-dependency detail", async () => {
		const res = await request(app).get(`${base}/readyz`);
		expect([200, 503]).toContain(res.status);
		expect(res.body.checks).toHaveProperty("vanillaDat");
		expect(res.body.checks).toHaveProperty("createDataMod");
	});
});

describe("POST /random seed validation", () => {
	/**
	 * Each of these payloads would previously have been interpolated into a
	 * shell command string and executed.
	 */
	const injectionPayloads = ["abc; touch /tmp/pwned", "abc && id", "abc`id`", "abc$(id)", "abc | id", "../../etc/passwd", "abc\nid", ""];

	it.each(injectionPayloads)("rejects seed %j with 400", async (seed) => {
		const res = await request(app).post(`${base}/random`).type("form").send({ seed, civs: "false", modifiers: "{}" });

		expect(res.status).toBe(400);
		expect(res.body.error).toMatch(/Invalid seed/);
	});

	it("rejects a missing seed", async () => {
		const res = await request(app).post(`${base}/random`).type("form").send({ civs: "false" });
		expect(res.status).toBe(400);
	});

	it("accepts a well-formed seed", async () => {
		const res = await request(app).post(`${base}/random`).type("form").send({ seed: "abc123", civs: "false", modifiers: "{}" });
		expect(res.status).toBe(200);
	});

	it("returns 400, not 500, for malformed modifiers JSON", async () => {
		const res = await request(app).post(`${base}/random`).type("form").send({ seed: "abc123", civs: "false", modifiers: "{not json" });

		expect(res.status).toBe(400);
		expect(res.body.error).toMatch(/Malformed modifiers/);
	});
});

describe("POST /create", () => {
	it("rejects a malformed presets payload with 400", async () => {
		const res = await request(app).post(`${base}/create`).type("form").send({ seed: "abc123", presets: "{oops", modifiers: "{}" });
		expect(res.status).toBe(400);
	});

	it("rejects presets that are not an array", async () => {
		const res = await request(app)
			.post(`${base}/create`)
			.type("form")
			.send({ seed: "abc123", presets: JSON.stringify({ presets: "nope" }), modifiers: "{}" });
		expect(res.status).toBe(400);
	});

	it("rejects an empty preset list", async () => {
		const res = await request(app)
			.post(`${base}/create`)
			.type("form")
			.send({ seed: "abc123", presets: JSON.stringify({ presets: [] }), modifiers: "{}" });
		expect(res.status).toBe(400);
	});
});

describe("POST /download path traversal", () => {
	beforeEach(() => {
		fs.mkdirSync(config.dirs.requestedMods, { recursive: true });
	});

	it("refuses traversal in draftID", async () => {
		for (const draftID of ["../../etc/passwd", "..%2f..%2fetc%2fpasswd", "/etc/passwd", "a/../../b"]) {
			const res = await request(app).post(`${base}/download`).type("form").send({ draftID });
			expect(res.status, draftID).toBe(400);
		}
	});

	it("returns 404 for a valid but absent archive", async () => {
		const res = await request(app).post(`${base}/download`).type("form").send({ draftID: "999999999999999" });
		expect(res.status).toBe(404);
	});

	it("serves an existing archive", async () => {
		stubArchive("123456789012345");
		const res = await request(app).post(`${base}/download`).type("form").send({ draftID: "123456789012345" });
		expect(res.status).toBe(200);
	});
});

describe("the removed /setCookie endpoint", () => {
	it("no longer exists, so a client cannot set arbitrary cookies", async () => {
		const res = await request(app).post(`${base}/setCookie`).type("form").send({ cookie: "playerNumber", value: "0" });

		expect(res.status).toBe(404);
		expect(res.headers["set-cookie"]).toBeUndefined();
	});
});

describe("draft creation", () => {
	it("creates a draft and returns the invite links", async () => {
		const res = await request(app).post(`${base}/draft`).type("form").send({
			num_players: "2",
			techtree_currency: "100",
			rounds: "3",
			allowed_rarities: "true,true,true,false,false",
		});

		expect(res.status).toBe(200);
		expect(res.text).toMatch(/draft\/player\/\d+/);
		expect(res.text).toMatch(/draft\/host\/\d+/);
	});

	it("rejects out-of-range player counts", async () => {
		for (const num_players of ["0", "99", "-1", "abc"]) {
			const res = await request(app).post(`${base}/draft`).type("form").send({
				num_players,
				techtree_currency: "100",
				rounds: "3",
				allowed_rarities: "true,true,true,true,true",
			});
			expect(res.status, num_players).toBe(400);
		}
	});

	it("rejects a draft with no allowed rarities", async () => {
		const res = await request(app).post(`${base}/draft`).type("form").send({
			num_players: "2",
			techtree_currency: "100",
			rounds: "3",
			allowed_rarities: "false,false,false,false,false",
		});
		expect(res.status).toBe(400);
	});
});

describe("draft seat authorization", () => {
	let draftId;

	beforeEach(() => {
		draftId = draftsStore.generateId();
		draftsStore.write(
			draftLogic.createDraft({
				id: draftId,
				slots: 2,
				points: 100,
				rounds: 2,
				rarities: [true, true, true, true, true],
			})
		);
	});

	it("issues a signed, httpOnly seat cookie on join", async () => {
		const res = await request(app).post(`${base}/join`).type("form").send({ draftID: draftId, joinType: "0", civ_name: "Host" });

		expect(res.status).toBe(302);
		const cookies = res.headers["set-cookie"].join(";");
		expect(cookies).toMatch(/seatToken=s%3A/); // "s:" prefix marks a signed cookie
		expect(cookies).toMatch(/HttpOnly/);
	});

	it("never exposes the seat token in the stored draft's public form", async () => {
		await request(app).post(`${base}/join`).type("form").send({ draftID: draftId, joinType: "0", civ_name: "Host" });

		const stored = draftsStore.read(draftId);
		expect(stored.players[0].token).toBeTruthy();
		expect(JSON.stringify(draftsStore.toPublic(stored))).not.toContain(stored.players[0].token);
	});

	it("does not let a forged playerNumber cookie grant a seat", async () => {
		// The old implementation trusted exactly this.
		const res = await request(app)
			.get(`${base}/draft/${draftId}`)
			.set("Cookie", [`draftID=${draftId}`, "playerNumber=0"]);

		expect(res.status).toBe(200);
		// Served the spectator page, not a seated player's view: no seat cookie
		// was ever issued to this client.
		expect(res.headers["set-cookie"]).toBeUndefined();
	});

	it("does not accept an unsigned seatToken cookie", async () => {
		// cookie-parser only populates req.signedCookies for values carrying a
		// valid signature, so a raw token presented by an attacker is ignored.
		await request(app).post(`${base}/join`).type("form").send({ draftID: draftId, joinType: "0", civ_name: "Host" });
		const token = draftsStore.read(draftId).players[0].token;

		const res = await request(app)
			.post(`${base}/join`)
			.type("form")
			.set("Cookie", [`seatToken=${token}`])
			.send({ draftID: draftId, joinType: "0", civ_name: "Impostor" });

		// Treated as a new join attempt, not as the already-seated host.
		expect(res.status).toBe(409);
	});

	it("rejects joining a nonexistent draft", async () => {
		const res = await request(app).post(`${base}/join`).type("form").send({ draftID: "999999999999999", joinType: "0", civ_name: "Host" });
		expect(res.status).toBe(404);
	});

	it("refuses a second host", async () => {
		await request(app).post(`${base}/join`).type("form").send({ draftID: draftId, joinType: "0", civ_name: "Host" });
		const res = await request(app).post(`${base}/join`).type("form").send({ draftID: draftId, joinType: "0", civ_name: "Impostor" });

		expect(res.status).toBe(409);
	});

	it("reports a full lobby", async () => {
		await request(app).post(`${base}/join`).type("form").send({ draftID: draftId, joinType: "1", civ_name: "P1" });
		const res = await request(app).post(`${base}/join`).type("form").send({ draftID: draftId, joinType: "1", civ_name: "P2" });

		expect(res.status).toBe(409);
	});

	it("requires a player name", async () => {
		const res = await request(app).post(`${base}/join`).type("form").send({ draftID: draftId, joinType: "0", civ_name: "" });
		expect(res.status).toBe(400);
	});

	it("returns 404 for a draft page with an invalid ID", async () => {
		const res = await request(app).get(`${base}/draft/..%2f..%2fetc%2fpasswd`);
		expect(res.status).toBe(404);
	});
});

describe("security headers", () => {
	it("sets helmet's protective headers", async () => {
		const res = await request(app).get(`${base}/healthz`);
		expect(res.headers["x-content-type-options"]).toBe("nosniff");
		expect(res.headers["content-security-policy"]).toBeTruthy();
		expect(res.headers["x-powered-by"]).toBeUndefined();
	});

	it("declines cross-origin requests from unlisted origins", async () => {
		const res = await request(app).get(`${base}/healthz`).set("Origin", "https://evil.test");
		expect(res.headers["access-control-allow-origin"]).toBeUndefined();
	});
});

describe("error handling", () => {
	it("returns a JSON 404 for unknown routes rather than an HTML stack", async () => {
		const res = await request(app).get(`${base}/definitely-not-a-route`);
		expect(res.status).toBe(404);
		expect(res.text).not.toMatch(/at Object|node_modules/);
	});
});
