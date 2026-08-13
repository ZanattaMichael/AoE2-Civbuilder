"use strict";

/**
 * Boots the real application against a throwaway APP_DIR for end-to-end runs.
 *
 * The fixture mirrors a real deployment except for two seams:
 *   - `create-data-mod` is a stub script. Building the C++ binary requires a
 *     toolchain and a ~10MB vanilla .dat that is not distributable, and the
 *     binary's own behaviour is covered by its own project. What matters here
 *     is that the pipeline invokes it correctly and packages the result.
 *   - Game art is not copied; the pages tolerate missing images.
 *
 * Everything else — routing, validation, cookies, sockets, packaging — is the
 * production code path.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const repoRoot = path.join(__dirname, "..");

function buildFixtureDir() {
	const appDir = fs.mkdtempSync(path.join(os.tmpdir(), "civbuilder-e2e-"));

	fs.mkdirSync(path.join(appDir, "drafts"), { recursive: true });
	fs.mkdirSync(path.join(appDir, "modding", "build"), { recursive: true });
	fs.mkdirSync(path.join(appDir, "modding", "requested_mods"), { recursive: true });

	// Real client-side assets, so the browser runs the code that ships.
	for (const dir of ["html", "js", "css", "pug", "vendor", "aoe2techtree"]) {
		const src = path.join(repoRoot, "public", dir);
		if (fs.existsSync(src)) {
			fs.cpSync(src, path.join(appDir, "public", dir), { recursive: true });
		}
	}

	fs.mkdirSync(path.join(appDir, "public", "img", "symbols"), { recursive: true });
	fs.mkdirSync(path.join(appDir, "public", "img", "uniticons"), { recursive: true });
	fs.mkdirSync(path.join(appDir, "public", "vanillaFiles", "vanillaCivs"), { recursive: true });
	fs.mkdirSync(path.join(appDir, "public", "vanillaFiles", "voiceFiles"), { recursive: true });

	// A 1x1 PNG stands in for the game art. The real public/img is ~245MB, which
	// would make every run slow for no benefit; the pages only need the requests
	// to succeed. Keeping this list complete is what lets the specs assert that
	// a page loads with *zero* failed requests.
	const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
	const referencedImages = [
		"thumbnail.jpg",
		"aoe2background.jpg",
		"helpbackground.png",
		"smokey.jpg",
		"kraken_invite.png",
		"kraken_logo_circular.png",
		"frames/mask_background.png",
		"frames/mask_common.png",
		"frames/mask_uncommon.png",
		"frames/mask_rare.png",
		"frames/mask_epic.png",
		"frames/mask_legendary.png",
		"uniticons/blank.png",
	];
	for (const rel of referencedImages) {
		const dest = path.join(appDir, "public", "img", rel);
		fs.mkdirSync(path.dirname(dest), { recursive: true });
		fs.writeFileSync(dest, pixel);
	}
	for (let i = 0; i < 40; i++) {
		fs.writeFileSync(path.join(appDir, "public", "img", "symbols", `symbol_${i}.png`), pixel);
	}
	fs.writeFileSync(path.join(appDir, "public", "vanillaFiles", "empires2_x2_p1.dat"), "stub-vanilla-dat");

	const stubBin = path.join(appDir, "modding", "build", "create-data-mod");
	fs.writeFileSync(stubBin, ["#!/bin/sh", "# $1=data.json $2=vanilla.dat $3=output.dat $4=aiconfig.json", 'mkdir -p "$(dirname "$3")"', 'printf "stub-dat" > "$3"', "exit 0"].join("\n") + "\n");
	fs.chmodSync(stubBin, 0o755);

	return appDir;
}

module.exports = { buildFixtureDir, repoRoot };

// Invoked as a child process by the Playwright webServer.
if (require.main === module) {
	const appDir = buildFixtureDir();

	process.env.APP_DIR = appDir;
	process.env.NODE_ENV = process.env.NODE_ENV || "development";
	process.env.COOKIE_SECRET = process.env.COOKIE_SECRET || "e2e-fixture-secret";
	process.env.PORT = process.env.PORT || "4599";
	process.env.PUBLIC_URL = `http://127.0.0.1:${process.env.PORT}/civbuilder`;
	process.env.LOG_LEVEL = process.env.LOG_LEVEL || "warn";
	process.env.CREATE_DATA_MOD_BIN = path.join(appDir, "modding", "build", "create-data-mod");

	console.log(`e2e fixture APP_DIR=${appDir}`);

	require(path.join(repoRoot, "src", "index.js")).start();

	const cleanup = () => {
		try {
			fs.rmSync(appDir, { recursive: true, force: true });
		} catch {
			// The OS reclaims the temp directory regardless.
		}
		process.exit(0);
	};
	process.on("SIGTERM", cleanup);
	process.on("SIGINT", cleanup);
}
