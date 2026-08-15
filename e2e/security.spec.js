"use strict";

const { test, expect, BASE, createDraft, joinDraft, seatOf, newPlayerContext } = require("./helpers");

/**
 * Security properties, exercised the way an attacker would: from a browser.
 *
 * Every case below corresponds to something the application previously allowed.
 * They are written against the running system rather than a unit, because the
 * bugs they cover lived in the gap between the client, the cookie layer and the
 * socket handlers.
 */

test.describe("seat forgery", () => {
	test("a forged playerNumber cookie grants nothing", async ({ browser, page }) => {
		const draft = await createDraft(page, { players: 2 });
		await joinDraft(page, draft.hostLink, "HostPlayer");
		await expect.poll(() => seatOf(page)).toBe(0);

		// The old implementation read exactly these cookies and believed them.
		const attackerContext = await newPlayerContext(browser);
		await attackerContext.addCookies([
			{ name: "draftID", value: draft.id, url: page.url() },
			{ name: "playerNumber", value: "0", url: page.url() },
		]);

		const attackerPage = await attackerContext.newPage();
		await attackerPage.goto(draft.spectatorLink);

		await expect.poll(() => seatOf(attackerPage)).toBe(-1);

		// And the forged seat cannot act.
		await attackerPage.evaluate(() => window.socket.emit("toggle ready"));
		await attackerPage.waitForTimeout(300);

		const state = await currentGamestate(page);
		expect(state.players[0].ready).toBe(0);

		await attackerContext.close();
	});

	test("an unsigned seatToken cookie is rejected", async ({ browser, page }) => {
		const draft = await createDraft(page, { players: 2 });
		await joinDraft(page, draft.hostLink, "HostPlayer");
		await expect.poll(() => seatOf(page)).toBe(0);

		// Lift the victim's raw token, then present it without a signature. This
		// is the case that slipped through: cookie-parser returns an unprefixed
		// value unchanged instead of rejecting it.
		const cookies = await page.context().cookies();
		const seatCookie = cookies.find((cookie) => cookie.name === "seatToken");
		expect(seatCookie, "host should hold a seat cookie").toBeDefined();

		const rawToken = decodeURIComponent(seatCookie.value).replace(/^s:/, "").split(".")[0];

		const attackerContext = await newPlayerContext(browser);
		await attackerContext.addCookies([{ name: "seatToken", value: rawToken, url: page.url() }]);
		const attackerPage = await attackerContext.newPage();
		await attackerPage.goto(draft.spectatorLink);

		await expect.poll(() => seatOf(attackerPage)).toBe(-1);

		await attackerContext.close();
	});

	test("the seat cookie is httpOnly, so script cannot read it", async ({ page }) => {
		const draft = await createDraft(page, { players: 2 });
		await joinDraft(page, draft.hostLink, "HostPlayer");

		const visibleToScript = await page.evaluate(() => document.cookie);
		expect(visibleToScript).not.toContain("seatToken");

		const cookies = await page.context().cookies();
		expect(cookies.find((cookie) => cookie.name === "seatToken").httpOnly).toBe(true);
	});
});

test.describe("action authorization over sockets", () => {
	test("a spectator cannot alter the draft", async ({ browser, page }) => {
		const draft = await createDraft(page, { players: 2 });
		await joinDraft(page, draft.hostLink, "HostPlayer");
		await expect.poll(() => seatOf(page)).toBe(0);

		const spectatorContext = await newPlayerContext(browser);
		const spectatorPage = await spectatorContext.newPage();
		await spectatorPage.goto(draft.spectatorLink);
		await expect.poll(() => seatOf(spectatorPage)).toBe(-1);

		await spectatorPage.evaluate(() => {
			window.socket.emit("toggle ready");
			window.socket.emit("start draft");
			window.socket.emit("clear");
			window.socket.emit("refill");
		});
		await spectatorPage.waitForTimeout(400);

		const state = await currentGamestate(page);
		expect(state.players[0].ready).toBe(0);
		expect(state.players[1].ready).toBe(0);
		expect(state.gamestate.phase).toBe(0);

		await spectatorContext.close();
	});

	test("a seated player cannot start the draft; only the host can", async ({ browser, page }) => {
		const draft = await createDraft(page, { players: 2 });
		await joinDraft(page, draft.hostLink, "HostPlayer");
		await expect.poll(() => seatOf(page)).toBe(0);

		const playerContext = await newPlayerContext(browser);
		const playerPage = await playerContext.newPage();
		await joinDraft(playerPage, draft.playerLink, "SecondPlayer");
		await expect.poll(() => seatOf(playerPage)).toBe(1);

		await playerPage.evaluate(() => window.socket.emit("start draft"));
		await playerPage.waitForTimeout(400);
		expect((await currentGamestate(page)).gamestate.phase).toBe(0);

		await page.evaluate(() => window.socket.emit("start draft"));
		await expect.poll(async () => (await currentGamestate(page)).gamestate.phase).toBe(1);

		await playerContext.close();
	});

	test("a player cannot ready up on another player's behalf", async ({ browser, page }) => {
		const draft = await createDraft(page, { players: 2 });
		await joinDraft(page, draft.hostLink, "HostPlayer");
		await expect.poll(() => seatOf(page)).toBe(0);

		const playerContext = await newPlayerContext(browser);
		const playerPage = await playerContext.newPage();
		await joinDraft(playerPage, draft.playerLink, "SecondPlayer");
		await expect.poll(() => seatOf(playerPage)).toBe(1);

		// The old protocol carried the player number in the message, so a client
		// could name any seat. The current handlers ignore extra arguments and
		// use the seat bound to the connection.
		await playerPage.evaluate(() => window.socket.emit("toggle ready", 0));
		await playerPage.waitForTimeout(400);

		const state = await currentGamestate(page);
		expect(state.players[1].ready, "the caller's own seat changes").toBe(1);
		expect(state.players[0].ready, "the other seat must not").toBe(0);

		await playerContext.close();
	});

	test("actions against a draft the socket never joined are ignored", async ({ browser, page }) => {
		const first = await createDraft(page, { players: 2 });
		await joinDraft(page, first.hostLink, "HostPlayer");
		await expect.poll(() => seatOf(page)).toBe(0);

		const otherContext = await newPlayerContext(browser);
		const otherPage = await otherContext.newPage();
		const second = await createDraft(otherPage, { players: 2 });
		await joinDraft(otherPage, second.hostLink, "OtherHost");
		await expect.poll(() => seatOf(otherPage)).toBe(0);

		// Attempt to act on the first draft from a socket joined to the second.
		await otherPage.evaluate((roomId) => window.socket.emit("toggle ready", roomId), first.id);
		await otherPage.waitForTimeout(400);

		expect((await currentGamestate(page)).players[0].ready).toBe(0);

		await otherContext.close();
	});
});

test.describe("removed endpoints", () => {
	test("POST /setCookie no longer exists", async ({ page }) => {
		const response = await page.request.post(`${BASE}/setCookie`, {
			form: { cookie: "playerNumber", value: "0" },
		});

		expect(response.status()).toBe(404);
		expect(response.headers()["set-cookie"]).toBeUndefined();
	});
});

async function currentGamestate(page) {
	return page.evaluate(
		() =>
			new Promise((resolve) => {
				window.socket.once("set gamestate", (state) => resolve(state));
				window.socket.emit("get gamestate");
			})
	);
}
