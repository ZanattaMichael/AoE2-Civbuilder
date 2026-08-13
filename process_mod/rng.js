"use strict";

const seedrandom = require("seedrandom");

/**
 * Injectable randomness.
 *
 * The generation code used bare Math.random() throughout, so the "seed" a user
 * supplied had no effect on the mod they received and nothing about generation
 * was reproducible — which also made it untestable. Callers now thread an
 * explicit Rng through, defaulting to a non-deterministic one so existing
 * behaviour is preserved where no seed is given.
 */

class Rng {
	constructor(seed) {
		this._next = seed === undefined || seed === null ? Math.random : seedrandom(String(seed));
	}

	/** Float in [0, 1). */
	next() {
		return this._next();
	}

	/** Integer in [0, max). */
	int(max) {
		return Math.floor(this._next() * max);
	}

	/** Integer in [min, max). */
	range(min, max) {
		return Math.floor(this._next() * (max - min) + min);
	}

	/** Removes and returns a random element, or undefined when empty. */
	pluck(array) {
		if (!Array.isArray(array) || array.length === 0) {
			return undefined;
		}
		return array.splice(this.int(array.length), 1)[0];
	}

	/** Returns a random element without removing it. */
	pick(array) {
		if (!Array.isArray(array) || array.length === 0) {
			return undefined;
		}
		return array[this.int(array.length)];
	}
}

/** Shared non-deterministic instance for callers that do not supply a seed. */
const defaultRng = new Rng();

function createRng(seed) {
	return new Rng(seed);
}

module.exports = { Rng, createRng, defaultRng };
