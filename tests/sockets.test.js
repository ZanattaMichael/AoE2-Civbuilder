import http from "node:http";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Server } from "socket.io";
import { io as connect } from "socket.io-client";
import cookieSignature from "cookie-signature";

import draftSockets from "../src/sockets/draft.js";
import draftsStore from "../src/services/drafts.js";
import draftLogic from "../src/services/draft-logic.js";
import config from "../src/config.js";

/**
 * Socket authorization.
 *
 * Before this change every handler took a room ID and player number from the
 * message body, so any connected client could act as any player in any draft.
 * These tests drive a real socket.io server and assert that a client can only
 * affect the seat its signed cookie proves it owns.
 */

let httpServer;
let ioServer;
let port;

beforeAll(async () => {
	httpServer = http.createServer();
	ioServer = new Server(httpServer);
	draftSockets.register(ioServer);
	await new Promise((resolve) => httpServer.listen(0, resolve));
	port = httpServer.address().port;
});

afterAll(async () => {
	ioServer.close();
	await new Promise((resolve) => httpServer.close(resolve));
});

/** Builds the Cookie header a seated player's browser would send. */
function seatCookie(token) {
	const signed = `s:${cookieSignature.sign(token, config.cookieSecret)}`;
	return `seatToken=${encodeURIComponent(signed)}`;
}

function client(cookieHeader) {
	return connect(`http://127.0.0.1:${port}`, {
		transports: ["websocket"],
		forceNew: true,
		extraHeaders: cookieHeader ? { Cookie: cookieHeader } : {},
	});
}

/** Connects, joins the room, and resolves with the seat the server assigned. */
function joinRoom(socket, roomId) {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error("join timed out")), 5000);
		socket.on("seat assigned", (seat) => {
			clearTimeout(timer);
			resolve(seat);
		});
		socket.on("connect", () => socket.emit("join room", roomId));
		socket.on("connect_error", reject);
	});
}

/** Waits briefly for any server-side write to land. */
function settle(ms = 120) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("socket seat assignment", () => {
	let draftId;
	let hostToken;
	let playerToken;

	beforeEach(() => {
		draftId = draftsStore.generateId();
		const draft = draftLogic.createDraft({
			id: draftId,
			slots: 2,
			points: 100,
			rounds: 2,
			rarities: [true, true, true, true, true],
		});
		hostToken = draftsStore.issueSeatToken();
		playerToken = draftsStore.issueSeatToken();
		draft.players[0].name = "Host";
		draft.players[0].token = hostToken;
		draft.players[1].name = "Player";
		draft.players[1].token = playerToken;
		draftsStore.write(draft);
	});

	it("assigns the seat proved by the signed cookie", async () => {
		const socket = client(seatCookie(hostToken));
		const seat = await joinRoom(socket, draftId);
		expect(seat).toBe(0);
		socket.close();
	});

	it("assigns seat 1 to the second player's token", async () => {
		const socket = client(seatCookie(playerToken));
		const seat = await joinRoom(socket, draftId);
		expect(seat).toBe(1);
		socket.close();
	});

	it("treats a client with no cookie as a spectator", async () => {
		const socket = client(null);
		const seat = await joinRoom(socket, draftId);
		expect(seat).toBe(-1);
		socket.close();
	});

	it("treats an unsigned or forged token as a spectator", async () => {
		// An attacker who guesses the cookie name but cannot sign it.
		const socket = client(`seatToken=${hostToken}`);
		const seat = await joinRoom(socket, draftId);
		expect(seat).toBe(-1);
		socket.close();
	});

	it("treats a token from another draft as a spectator", async () => {
		const otherId = draftsStore.generateId();
		const other = draftLogic.createDraft({
			id: otherId,
			slots: 2,
			points: 100,
			rounds: 2,
			rarities: [true, true, true, true, true],
		});
		const otherToken = draftsStore.issueSeatToken();
		other.players[0].token = otherToken;
		draftsStore.write(other);

		const socket = client(seatCookie(otherToken));
		const seat = await joinRoom(socket, draftId);
		expect(seat).toBe(-1);
		socket.close();
	});
});

describe("socket action authorization", () => {
	let draftId;
	let hostToken;
	let playerToken;

	beforeEach(() => {
		draftId = draftsStore.generateId();
		const draft = draftLogic.createDraft({
			id: draftId,
			slots: 2,
			points: 100,
			rounds: 2,
			rarities: [true, true, true, true, true],
		});
		hostToken = draftsStore.issueSeatToken();
		playerToken = draftsStore.issueSeatToken();
		draft.players[0].token = hostToken;
		draft.players[1].token = playerToken;
		draftsStore.write(draft);
	});

	it("applies toggle ready to the caller's own seat only", async () => {
		const socket = client(seatCookie(playerToken));
		await joinRoom(socket, draftId);

		socket.emit("toggle ready");
		await settle();

		const draft = draftsStore.read(draftId);
		expect(draft.players[1].ready).toBe(1);
		// Seat 0 is untouched: the caller cannot mark another player ready.
		expect(draft.players[0].ready).toBe(0);
		socket.close();
	});

	it("ignores player actions from a spectator", async () => {
		const socket = client(null);
		await joinRoom(socket, draftId);

		socket.emit("toggle ready");
		socket.emit("clear");
		await settle();

		const draft = draftsStore.read(draftId);
		expect(draft.players[0].ready).toBe(0);
		expect(draft.players[1].ready).toBe(0);
		socket.close();
	});

	it("lets only the host start the draft", async () => {
		const nonHost = client(seatCookie(playerToken));
		await joinRoom(nonHost, draftId);
		nonHost.emit("start draft");
		await settle();

		expect(draftsStore.read(draftId).gamestate.phase).toBe(draftLogic.PHASES.LOBBY);
		nonHost.close();

		const host = client(seatCookie(hostToken));
		await joinRoom(host, draftId);
		host.emit("start draft");
		await settle();

		expect(draftsStore.read(draftId).gamestate.phase).toBe(draftLogic.PHASES.CIV_SETUP);
		host.close();
	});

	it("never broadcasts seat tokens to clients", async () => {
		const socket = client(seatCookie(hostToken));
		await joinRoom(socket, draftId);

		const gamestate = await new Promise((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error("no gamestate")), 5000);
			socket.on("set gamestate", (draft) => {
				clearTimeout(timer);
				resolve(draft);
			});
			socket.emit("get gamestate");
		});

		expect(JSON.stringify(gamestate)).not.toContain(hostToken);
		expect(JSON.stringify(gamestate)).not.toContain(playerToken);
		for (const player of gamestate.players) {
			expect(player).not.toHaveProperty("token");
		}
		socket.close();
	});

	it("ignores actions for a draft the socket never joined", async () => {
		const socket = client(seatCookie(hostToken));
		await new Promise((resolve) => socket.on("connect", resolve));

		// No "join room" was sent, so there is no room context to act on.
		socket.emit("toggle ready");
		await settle();

		const draft = draftsStore.read(draftId);
		expect(draft.players[0].ready).toBe(0);
		socket.close();
	});

	it("ignores a join for a nonexistent draft", async () => {
		const socket = client(seatCookie(hostToken));
		await new Promise((resolve) => socket.on("connect", resolve));

		let assigned = false;
		socket.on("seat assigned", () => (assigned = true));
		socket.emit("join room", "999999999999999");
		await settle();

		expect(assigned).toBe(false);
		socket.close();
	});

	it("ignores a join with a traversal-shaped room ID", async () => {
		const socket = client(seatCookie(hostToken));
		await new Promise((resolve) => socket.on("connect", resolve));

		let assigned = false;
		socket.on("seat assigned", () => (assigned = true));
		socket.emit("join room", "../../etc/passwd");
		await settle();

		expect(assigned).toBe(false);
		socket.close();
	});
});
