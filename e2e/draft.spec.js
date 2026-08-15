"use strict";

const { test, expect, BASE, createDraft, joinDraft, seatOf, newPlayerContext } = require("./helpers");

/**
 * Multiplayer drafting across independent browser contexts.
 *
 * Each context has its own cookie jar, so this is a faithful stand-in for
 * separate players: the host, a second player, and an unauthenticated
 * spectator. It exercises the socket protocol, seat assignment, and the
 * server-side authorization that replaced the client-asserted player number.
 */

test.describe("draft lobby", () => {
	test("creating a draft returns three distinct invite links", async ({ page }) => {
		await page.goto(`${BASE}/`);
		const draft = await createDraft(page, { players: 2 });

		expect(draft.id).toMatch(/^\d{15}$/);
		expect(draft.hostLink).not.toBe(draft.playerLink);
		expect(draft.spectatorLink).not.toBe(draft.playerLink);
	});

	test("the host link shows a join form and seats the host", async ({ page }) => {
		const draft = await createDraft(page, { players: 2 });

		await page.goto(draft.hostLink);
		await expect(page.locator("#join_form")).toBeVisible();
		await expect(page.locator("#title")).toHaveText("Civilization Drafter");

		await joinDraft(page, draft.hostLink, "HostPlayer");

		// The join redirects to the draft page, where the server assigns a seat.
		await expect(page).toHaveURL(new RegExp(`/draft/${draft.id}$`));
		await expect.poll(() => seatOf(page)).toBe(0);
	});

	test("a second player takes the next seat", async ({ browser, page }) => {
		const draft = await createDraft(page, { players: 2 });

		await joinDraft(page, draft.hostLink, "HostPlayer");
		await expect.poll(() => seatOf(page)).toBe(0);

		const playerContext = await newPlayerContext(browser);
		const playerPage = await playerContext.newPage();
		await joinDraft(playerPage, draft.playerLink, "SecondPlayer");
		await expect.poll(() => seatOf(playerPage)).toBe(1);

		await playerContext.close();
	});

	test("a spectator gets no seat", async ({ browser, page }) => {
		const draft = await createDraft(page, { players: 2 });

		const spectatorContext = await newPlayerContext(browser);
		const spectatorPage = await spectatorContext.newPage();
		await spectatorPage.goto(draft.spectatorLink);

		// -1 marks a spectator. It must never resolve to a real seat.
		await expect.poll(() => seatOf(spectatorPage)).toBe(-1);

		await spectatorContext.close();
	});

	test("the lobby is full once every slot is taken", async ({ browser, page }) => {
		const draft = await createDraft(page, { players: 2 });

		await joinDraft(page, draft.hostLink, "HostPlayer");

		const second = await newPlayerContext(browser);
		await joinDraft(await second.newPage(), draft.playerLink, "SecondPlayer");

		const third = await newPlayerContext(browser);
		const thirdPage = await third.newPage();
		const response = await thirdPage.request.post(`${BASE}/join`, {
			form: { draftID: draft.id, joinType: "1", civ_name: "Latecomer" },
			maxRedirects: 0,
		});
		expect(response.status()).toBe(409);

		await second.close();
		await third.close();
	});

	test("a draft that does not exist returns 404", async ({ page }) => {
		const response = await page.goto(`${BASE}/draft/999999999999999`);
		expect(response.status()).toBe(404);
	});
});

test.describe("draft gameplay", () => {
	test("both players ready up and the host starts the draft", async ({ browser, page }) => {
		const draft = await createDraft(page, { players: 2 });

		await joinDraft(page, draft.hostLink, "HostPlayer");
		await expect.poll(() => seatOf(page)).toBe(0);

		const playerContext = await newPlayerContext(browser);
		const playerPage = await playerContext.newPage();
		await joinDraft(playerPage, draft.playerLink, "SecondPlayer");
		await expect.poll(() => seatOf(playerPage)).toBe(1);

		// Both players mark themselves ready over the socket.
		await page.evaluate(() => window.socket.emit("toggle ready"));
		await playerPage.evaluate(() => window.socket.emit("toggle ready"));

		await expect
			.poll(async () => {
				const state = await gamestate(page);
				return state.players.map((player) => player.ready);
			})
			.toEqual([1, 1]);

		// Only the host may advance the lobby.
		await page.evaluate(() => window.socket.emit("start draft"));

		await expect.poll(async () => (await gamestate(page)).gamestate.phase).toBe(1);

		await playerContext.close();
	});

	test("the gamestate broadcast never contains seat tokens", async ({ browser, page }) => {
		const draft = await createDraft(page, { players: 2 });
		await joinDraft(page, draft.hostLink, "HostPlayer");
		await expect.poll(() => seatOf(page)).toBe(0);

		const playerContext = await newPlayerContext(browser);
		const playerPage = await playerContext.newPage();
		await joinDraft(playerPage, draft.playerLink, "SecondPlayer");
		await expect.poll(() => seatOf(playerPage)).toBe(1);

		const received = await page.evaluate(
			() =>
				new Promise((resolve) => {
					window.socket.once("set gamestate", (state) => resolve(JSON.stringify(state)));
					window.socket.emit("get gamestate");
				})
		);

		expect(received).not.toContain("token");
		const state = JSON.parse(received);
		for (const player of state.players) {
			expect(player.token).toBeUndefined();
		}

		await playerContext.close();
	});
});

/**
 * Asks the page's own socket for the current gamestate.
 *
 * There is no HTTP endpoint for draft state — it is delivered over socket.io —
 * so this round-trips through the same channel the client uses.
 */
async function gamestate(page) {
	return page.evaluate(
		() =>
			new Promise((resolve) => {
				window.socket.once("set gamestate", (state) => resolve(state));
				window.socket.emit("get gamestate");
			})
	);
}
