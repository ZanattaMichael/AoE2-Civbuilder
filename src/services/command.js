"use strict";

const { execFile } = require("child_process");
const { promisify } = require("util");

const config = require("../config");
const logger = require("../logger");

const execFileAsync = promisify(execFile);

/**
 * Runs an external binary.
 *
 * Deliberately uses execFile with an argv array rather than exec with a command
 * string: there is no shell, so no amount of metacharacters in an argument can
 * change what gets executed. Every call site that previously built a shell
 * string out of request data goes through here.
 */
async function run(file, args = [], options = {}) {
	if (typeof file !== "string" || file.length === 0) {
		throw new TypeError("run() requires an executable path");
	}
	if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) {
		throw new TypeError("run() requires all arguments to be strings");
	}

	logger.debug(`exec: ${file} ${args.join(" ")}`);

	try {
		const { stdout, stderr } = await execFileAsync(file, args, {
			cwd: options.cwd || config.dirs.app,
			timeout: options.timeoutMs || config.limits.commandTimeoutMs,
			maxBuffer: options.maxBuffer || 16 * 1024 * 1024,
			// shell is never enabled; this is the whole point of the module.
			shell: false,
			env: options.env || process.env,
		});
		if (stderr && stderr.trim()) {
			logger.debug(`stderr from ${file}: ${stderr.trim()}`);
		}
		return { stdout, stderr };
	} catch (err) {
		logger.error(`Command failed: ${file} ${args.join(" ")} -> ${err.message}`);
		throw err;
	}
}

module.exports = { run };
