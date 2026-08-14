"use strict";

const express = require("express");
const bodyParser = require("body-parser");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");

const config = require("./config");
const { notFoundHandler, errorHandler } = require("./errors");
const { generalRateLimiter } = require("./middleware/rate-limit");

const pagesRouter = require("./routes/pages");
const modsRouter = require("./routes/mods");
const draftsRouter = require("./routes/drafts");
const healthRouter = require("./routes/health");

/**
 * Builds the Express application.
 *
 * Exposed as a factory so tests can construct an isolated instance rather than
 * importing a module that starts listening as a side effect.
 */
function createApp() {
	const app = express();

	// Behind a reverse proxy the client IP must come from X-Forwarded-For for
	// rate limiting to work per-client rather than per-proxy.
	app.set("trust proxy", Number.parseInt(process.env.TRUST_PROXY_HOPS || "1", 10));
	app.set("view engine", "pug");
	app.set("views", config.dirs.views);
	app.disable("x-powered-by");

	app.use(
		helmet({
			contentSecurityPolicy: {
				directives: {
					defaultSrc: ["'self'"],
					// No third-party script origins: jQuery is vendored under
					// public/vendor rather than loaded from a CDN, so a compromised
					// CDN cannot execute script on this origin. 'unsafe-inline' is
					// still required because the pages build their DOM with inline
					// handlers and the pug views inline their scripts.
					scriptSrc: ["'self'", "'unsafe-inline'"],
					// draft.html pulls the Merriweather webfont from Google Fonts.
					styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
					fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
					imgSrc: ["'self'", "data:"],
					connectSrc: ["'self'", "ws:", "wss:"],
					objectSrc: ["'none'"],
					frameAncestors: ["'none'"],
					// helmet turns this on by default. `null` removes an inherited
					// default directive; see config.upgradeInsecureRequests for why a
					// plain-HTTP deployment has to be able to switch it off.
					...(config.upgradeInsecureRequests ? {} : { upgradeInsecureRequests: null }),
				},
			},
			// The site serves game assets to the page itself; the default
			// same-origin policy would block the techtree images.
			crossOriginResourcePolicy: { policy: "same-site" },
		})
	);

	if (config.corsOrigins.length > 0) {
		app.use((req, res, next) => {
			const origin = req.headers.origin;
			if (origin && config.corsOrigins.includes(origin)) {
				res.setHeader("Access-Control-Allow-Origin", origin);
				res.setHeader("Vary", "Origin");
				res.setHeader("Access-Control-Allow-Credentials", "true");
			}
			next();
		});
	}

	app.use(bodyParser.urlencoded({ extended: false, limit: config.limits.bodyLimit }));
	app.use(bodyParser.json({ limit: config.limits.bodyLimit }));
	app.use(cookieParser(config.cookieSecret));

	app.use(config.basePath, healthRouter);

	app.use(
		config.basePath,
		express.static(config.dirs.public, {
			maxAge: "1y",
			immutable: false,
			etag: true,
			lastModified: true,
			// Never serve directory listings or dotfiles from the asset tree.
			dotfiles: "ignore",
			index: false,
			setHeaders: (res, filePath) => {
				if (filePath.endsWith(".png") || filePath.endsWith(".jpg")) {
					res.set("Cache-Control", "public, must-revalidate, max-age=31536000");
				} else {
					res.set("Cache-Control", "no-cache, must-revalidate");
				}
			},
		})
	);

	const router = express.Router();
	router.use(generalRateLimiter);
	router.use(pagesRouter);
	router.use(modsRouter);
	router.use(draftsRouter);

	app.use(config.basePath, router);

	app.use(notFoundHandler);
	app.use(errorHandler);

	return app;
}

module.exports = { createApp };
