"use strict";

const zlib = require("node:zlib");

/**
 * A minimal, read-only zip reader.
 *
 * The end-to-end suite needs to look *inside* a generated mod — the archive
 * nests a data zip and a UI zip, and the civilizations that went in are only
 * observable in the modded strings file within them. Asserting on the raw bytes
 * can only reach entry names, which are stored uncompressed in the headers;
 * everything that actually proves the mod was built correctly is deflated.
 *
 * Node ships no zip reader, and this is the whole of what the suite needs, so
 * it reads the central directory directly rather than adding a dependency. The
 * producer is `archiver`, so only the stored (0) and deflate (8) methods occur.
 */

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_FILE_HEADER = 0x02014b50;

/** Locates the end-of-central-directory record, scanning back from the tail. */
function findEndOfCentralDirectory(buffer) {
	// The record is 22 bytes plus a comment; archiver writes no comment, but
	// scanning back keeps this correct if one ever appears.
	for (let offset = buffer.length - 22; offset >= 0; offset--) {
		if (buffer.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY) {
			return offset;
		}
	}
	throw new Error("Not a zip archive: no end-of-central-directory record");
}

/**
 * Lists the archive's entries.
 *
 * Returns `{ name, compressedSize, size, method, localHeaderOffset }` per entry,
 * directories included — they appear as zero-length entries with a trailing `/`.
 */
function listEntries(buffer) {
	const eocd = findEndOfCentralDirectory(buffer);
	const entryCount = buffer.readUInt16LE(eocd + 10);
	let offset = buffer.readUInt32LE(eocd + 16);

	const entries = [];
	for (let i = 0; i < entryCount; i++) {
		if (buffer.readUInt32LE(offset) !== CENTRAL_FILE_HEADER) {
			throw new Error(`Corrupt central directory at entry ${i}`);
		}
		const nameLength = buffer.readUInt16LE(offset + 28);
		const extraLength = buffer.readUInt16LE(offset + 30);
		const commentLength = buffer.readUInt16LE(offset + 32);

		entries.push({
			name: buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8"),
			method: buffer.readUInt16LE(offset + 10),
			compressedSize: buffer.readUInt32LE(offset + 20),
			size: buffer.readUInt32LE(offset + 24),
			localHeaderOffset: buffer.readUInt32LE(offset + 42),
		});

		offset += 46 + nameLength + extraLength + commentLength;
	}
	return entries;
}

/** Returns the entry names that are files rather than directory markers. */
function listFileNames(buffer) {
	return listEntries(buffer)
		.filter((entry) => !entry.name.endsWith("/"))
		.map((entry) => entry.name);
}

/** Reads one entry's decompressed bytes. */
function readEntry(buffer, entry) {
	// The local header repeats the name and extra fields, and its extra field
	// length can differ from the central directory's, so it must be read here
	// rather than assumed.
	const nameLength = buffer.readUInt16LE(entry.localHeaderOffset + 26);
	const extraLength = buffer.readUInt16LE(entry.localHeaderOffset + 28);
	const start = entry.localHeaderOffset + 30 + nameLength + extraLength;
	const raw = buffer.subarray(start, start + entry.compressedSize);

	if (entry.method === 0) {
		return Buffer.from(raw);
	}
	if (entry.method === 8) {
		return zlib.inflateRawSync(raw);
	}
	throw new Error(`Unsupported compression method ${entry.method} for ${entry.name}`);
}

/** Reads a named entry, throwing if the archive does not contain it. */
function readFile(buffer, name) {
	const entry = listEntries(buffer).find((candidate) => candidate.name === name);
	if (!entry) {
		throw new Error(`No entry ${name}. Archive contains: ${listFileNames(buffer).join(", ")}`);
	}
	return readEntry(buffer, entry);
}

/** Reads the first entry whose name matches, throwing if none does. */
function readMatching(buffer, pattern) {
	const entry = listEntries(buffer).find((candidate) => pattern.test(candidate.name));
	if (!entry) {
		throw new Error(`No entry matching ${pattern}. Archive contains: ${listFileNames(buffer).join(", ")}`);
	}
	return readEntry(buffer, entry);
}

module.exports = { listEntries, listFileNames, readEntry, readFile, readMatching };
