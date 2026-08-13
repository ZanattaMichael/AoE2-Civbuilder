"use strict";

/**
 * Backwards-compatible entrypoint.
 *
 * The application now lives in ./src. This file is kept so existing deployment
 * tooling that runs `node server.js`, or that mounts the exported router into an
 * outer Express app, keeps working.
 *
 * @see src/index.js  process entrypoint
 * @see src/app.js    Express application
 * @see src/sockets/draft.js  socket.io handlers
 */

const { createApp } = require("./src/app");
const draftSockets = require("./src/sockets/draft");
const { start } = require("./src/index");

module.exports = {
	createApp,
	start,
	/** Attaches the draft socket handlers to an existing socket.io server. */
	io: draftSockets.register,
};

if (require.main === module) {
	start();
}
