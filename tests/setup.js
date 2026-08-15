"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

/**
 * Global test setup.
 *
 * Each test process gets its own APP_DIR under the OS temp directory so that
 * suites writing drafts and mod archives cannot interfere with each other or
 * with the developer's working tree.
 */

const appDir = fs.mkdtempSync(path.join(os.tmpdir(), "civbuilder-test-"));

fs.mkdirSync(path.join(appDir, "drafts"), { recursive: true });
fs.mkdirSync(path.join(appDir, "modding", "requested_mods"), { recursive: true });
fs.mkdirSync(path.join(appDir, "public", "html"), { recursive: true });
fs.mkdirSync(path.join(appDir, "public", "img"), { recursive: true });
fs.mkdirSync(path.join(appDir, "public", "vanillaFiles", "vanillaCivs"), { recursive: true });

// The route handlers sendFile these; the contents are irrelevant to the tests.
for (const page of ["civbuilder_home.html", "civbuilder.html", "view.html", "edit.html", "draft.html", "join.html"]) {
	fs.writeFileSync(path.join(appDir, "public", "html", page), `<!doctype html><title>${page}</title>`);
}

// Pug views are read from the real repository so template changes are exercised.
// The templates inline ../css/styles.css and ../js/client.js at compile time, so
// those must be present in the fixture too.
const repoRoot = path.join(__dirname, "..");
fs.cpSync(path.join(repoRoot, "public", "pug"), path.join(appDir, "public", "pug"), { recursive: true });
fs.cpSync(path.join(repoRoot, "public", "css"), path.join(appDir, "public", "css"), { recursive: true });
fs.cpSync(path.join(repoRoot, "public", "js"), path.join(appDir, "public", "js"), { recursive: true });

// A stand-in for the C++ .dat rewriter. The native binary is not built in CI,
// and its behaviour is not what these tests are checking — what matters is that
// the pipeline invokes it with the right argv and handles its result. It writes
// its output file so downstream packaging has something to zip.
const stubBin = path.join(appDir, "modding", "build", "create-data-mod");
fs.mkdirSync(path.dirname(stubBin), { recursive: true });
fs.writeFileSync(stubBin, ["#!/bin/sh", "# $1=data.json $2=vanilla.dat $3=output.dat $4=aiconfig.json", 'mkdir -p "$(dirname "$3")"', 'printf "stub-dat" > "$3"', "exit 0"].join("\n") + "\n");
fs.chmodSync(stubBin, 0o755);

// The pipeline copies this into each generated mod; contents are irrelevant.
fs.writeFileSync(path.join(appDir, "public", "vanillaFiles", "empires2_x2_p1.dat"), "stub-vanilla-dat");
fs.writeFileSync(path.join(appDir, "public", "img", "thumbnail.jpg"), "stub-jpg");

process.env.NODE_ENV = "test";
// These suites make hundreds of requests; rate limiting would make results
// depend on test order. Limiter behaviour is asserted separately.
process.env.RATE_LIMIT_DISABLED = "true";
process.env.APP_DIR = appDir;
process.env.CREATE_DATA_MOD_BIN = stubBin;
process.env.COOKIE_SECRET = "test-secret-not-used-in-production";
process.env.PUBLIC_URL = "http://localhost:4000/civbuilder";
process.env.BASE_PATH = "/civbuilder";
// Silent by default; export LOG_LEVEL=debug to see server logs while debugging.
process.env.LOG_LEVEL = process.env.LOG_LEVEL || "silent";

process.on("exit", () => {
	try {
		fs.rmSync(appDir, { recursive: true, force: true });
	} catch {
		// Best effort; the OS will reclaim the temp directory regardless.
	}
});
