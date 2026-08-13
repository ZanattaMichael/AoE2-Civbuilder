"use strict";

const express = require("express");

const config = require("../config");

const router = express.Router();
const htmlRoot = `${config.dirs.public}/html`;

/** Static page routes. */
function page(file) {
	return (req, res) => res.sendFile(file, { root: htmlRoot });
}

router.get("/", page("civbuilder_home.html"));
router.get("/build", page("civbuilder.html"));
router.get("/view", page("view.html"));
router.get("/edit", page("edit.html"));

// The builder posts a civilization to these so the page can render it; the
// payload is read client-side from the form, so the server just returns the page.
router.post("/view", page("view.html"));
router.post("/edit", page("edit.html"));

module.exports = router;
