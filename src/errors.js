"use strict";

const logger = require("./logger");
const config = require("./config");

/** An error that is safe to surface to the client, with an HTTP status. */
class HttpError extends Error {
	constructor(status, message, options = {}) {
		super(message, options);
		this.name = "HttpError";
		this.status = status;
		this.expose = true;
	}
}

class BadRequestError extends HttpError {
	constructor(message, options) {
		super(400, message, options);
		this.name = "BadRequestError";
	}
}

class ForbiddenError extends HttpError {
	constructor(message, options) {
		super(403, message, options);
		this.name = "ForbiddenError";
	}
}

class NotFoundError extends HttpError {
	constructor(message, options) {
		super(404, message, options);
		this.name = "NotFoundError";
	}
}

/**
 * Wraps an async route handler so a rejected promise reaches the error
 * middleware instead of hanging the request. Express 4 does not do this itself.
 */
function asyncHandler(handler) {
	return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function notFoundHandler(req, res, next) {
	next(new NotFoundError(`Cannot ${req.method} ${req.path}`));
}

/**
 * Terminal error middleware. Without this, an unguarded JSON.parse of a request
 * body would take the whole process down.
 */
function errorHandler(err, req, res, next) {
	const status = Number.isInteger(err.status) ? err.status : 500;

	if (status >= 500) {
		logger.error(`${req.method} ${req.originalUrl} failed:`, err.stack || err.message);
	} else {
		logger.warn(`${req.method} ${req.originalUrl} rejected: ${err.message}`);
	}

	if (res.headersSent) {
		return next(err);
	}

	// Internal errors never leak their message or stack to the client.
	const body = {
		error: err.expose && status < 500 ? err.message : "Internal server error",
	};
	if (!config.isProduction && status >= 500) {
		body.detail = err.message;
	}

	res.status(status);
	if (req.accepts("html") && !req.accepts("json")) {
		return res.type("text/plain").send(body.error);
	}
	return res.json(body);
}

module.exports = {
	HttpError,
	BadRequestError,
	ForbiddenError,
	NotFoundError,
	asyncHandler,
	notFoundHandler,
	errorHandler,
};
