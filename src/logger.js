"use strict";

const config = require("./config");

const LEVELS = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };
const threshold = LEVELS[config.logLevel] ?? LEVELS.info;

function emit(level, stream, args) {
	if (LEVELS[level] > threshold) {
		return;
	}
	stream(`[${new Date().toISOString()}] [${level.toUpperCase()}]`, ...args);
}

module.exports = {
	error: (...args) => emit("error", console.error, args),
	warn: (...args) => emit("warn", console.warn, args),
	info: (...args) => emit("info", console.log, args),
	debug: (...args) => emit("debug", console.log, args),
};
