# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security

- **Removed unauthenticated remote code execution.** The client-supplied `seed`
  was interpolated into shell command strings, so a crafted request executed
  arbitrary commands as the server user. External programs are now invoked with
  `execFile` and an argv array through a single runner, and the mod pipeline's
  shell scripts are reimplemented as filesystem calls.
- **Fixed draft seat forgery.** Seats were authorized by an unsigned
  `playerNumber` cookie. They are now proved by an unguessable signed, httpOnly
  token, with the player number derived server-side.
- **Fixed missing socket authorization.** Any client could act as any player in
  any draft. Sockets now bind their seat at handshake and ignore client-asserted
  seats; only the host can start a draft, and out-of-turn or off-board picks are
  rejected.
- Rejected unsigned seat cookies, which `cookie-parser` returns unchanged rather
  than refusing.
- Closed path traversal on mod and draft identifiers, with independent path
  containment behind the validators.
- Removed `POST /setCookie`, which let a client set arbitrary cookies.
- Added helmet, an explicit CORS policy, rate limiting on mod generation, and a
  terminal error handler; an unguarded `JSON.parse` previously crashed the
  process.
- Vendored jQuery instead of loading it from a CDN, so the Content-Security-Policy
  names no third-party script source.
- Removed npm packages shadowing Node builtins (`fs`, `path`, `util`,
  `child_process`) plus `fs-js` and unused dependencies.

### Added

- Container image: multi-stage `Dockerfile`, `docker-compose.yml`, `/healthz`
  and `/readyz` probes, non-root runtime.
- Test suites: Vitest unit, integration and exploit-validation suites, and a
  Playwright end-to-end suite that also runs against the built container image.
- CI: lint, format, tests, end-to-end, dependency audit, image build and boot
  check; CodeQL, secret scanning, dependency review and Trivy scans.
- Release pipeline publishing a versioned image to GHCR with an SBOM and build
  provenance, plus the native binary as a release asset.
- Seeded generation, so a given seed reproduces the same mod.

### Changed

- Split the 1,194-line `server.js` into `src/` modules; `server.js` remains as a
  compatibility shim.
- Replaced the hardcoded absolute path and per-request `process.chdir()` with
  environment-driven configuration.
- **Breaking:** the socket protocol no longer accepts a room ID or player number
  from the client; the server announces the seat with a `seat assigned` event.
- **Breaking:** `COOKIE_SECRET` is required when `NODE_ENV=production`.

### Fixed

- The random castle draw indexed the castle array with the wonder index.
- `generateNames` assigned to an undeclared global that persisted between calls.
- `applyPick` accepted `-1`, the "already taken" sentinel, as a selectable card.
- The host and player draft links served a page from the wrong path depth,
  breaking every relative asset on it.
