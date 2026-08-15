"use strict";

const http = require("http");
const fs = require("fs");

const config = require("./config");
const logger = require("./logger");
const { createApp } = require("./app");
const draftSockets = require("./sockets/draft");

/**
 * Process entrypoint: builds the app, attaches socket.io, and listens.
 *
 * The previous server.js exported a router and left `server.listen` commented
 * out, so the process could not run on its own. Having a real entrypoint is what
 * makes the container image runnable.
 */

function ensureRuntimeDirs() {
	for (const dir of [config.dirs.drafts, config.dirs.requestedMods]) {
		fs.mkdirSync(dir, { recursive: true });
	}
}

function start() {
	ensureRuntimeDirs();

	const app = createApp();
	const server = http.createServer(app);

	const { Server } = require("socket.io");
	const io = new Server(server, {
		cors: config.corsOrigins.length > 0 ? { origin: config.corsOrigins, credentials: true } : undefined,
	});
	draftSockets.register(io);

	server.listen(config.port, config.host, () => {
		logger.info(`Civbuilder listening on http://${config.host}:${config.port}${config.basePath}`);
		logger.info(`Environment: ${config.nodeEnv}, app dir: ${config.dirs.app}`);
	});

	const shutdown = (signal) => {
		logger.info(`Received ${signal}, shutting down`);
		io.close();
		server.close(() => process.exit(0));
		// Do not let a hung connection block the container from stopping.
		setTimeout(() => process.exit(1), 10000).unref();
	};

	process.on("SIGTERM", () => shutdown("SIGTERM"));
	process.on("SIGINT", () => shutdown("SIGINT"));

	process.on("unhandledRejection", (reason) => {
		logger.error("Unhandled promise rejection:", reason);
	});

	return { app, server, io };
}

if (require.main === module) {
	start();
}

module.exports = { start };
