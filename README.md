# AoE2-Civbuilder

Age of Empires II civilization builder and multiplayer drafting tool.
Hosted at https://krakenmeister.com/civbuilder

Generate randomised or hand-built civilizations, draft them with friends, and
download the result as an installable game mod.

## Quick start

### Docker (recommended)

```bash
cp .env.example .env
# COOKIE_SECRET is required — it signs the cookies that authorize draft seats.
echo "COOKIE_SECRET=$(openssl rand -hex 32)" >> .env

docker compose up --build
```

The site is then available at http://localhost:4000/civbuilder.

### Local development

Requires Node 22 (see `.nvmrc`).

```bash
npm ci
npm run dev
```

The native `create-data-mod` binary is needed for mod generation. To build it:

```bash
git submodule update --init modding/genieutils
sudo apt-get install build-essential cmake libjsoncpp-dev \
    zlib1g-dev liblz4-dev libboost-iostreams-dev
cd modding && ./scripts/build.sh
```

Everything except mod generation works without it; `GET /civbuilder/readyz`
reports whether it was found.

## Scripts

| Command                 | Description                               |
| ----------------------- | ----------------------------------------- |
| `npm start`             | Run the server                            |
| `npm run dev`           | Run with file watching                    |
| `npm test`              | Run the unit and integration suite        |
| `npm run test:coverage` | Run tests with a coverage report and gate |
| `npm run test:e2e`      | Run the Playwright end-to-end suite       |
| `npm run test:all`      | Run both suites                           |
| `npm run lint`          | Lint with ESLint                          |
| `npm run format`        | Format with Prettier                      |
| `npm run verify`        | Everything CI checks, locally             |
| `npm run build:native`  | Build the native `create-data-mod` binary |
| `npm run docker:build`  | Build the container image                 |
| `npm run docker:run`    | Build and run via docker compose          |

## Configuration

All configuration is environment-driven; see `.env.example` for the full list.
The ones that matter most:

| Variable                        | Default                            | Notes                                                |
| ------------------------------- | ---------------------------------- | ---------------------------------------------------- |
| `COOKIE_SECRET`                 | —                                  | **Required in production.** Signs seat cookies.      |
| `PORT`                          | `4000`                             | Listen port                                          |
| `APP_DIR`                       | repository root                    | Root for all derived paths                           |
| `BASE_PATH`                     | `/civbuilder`                      | Path prefix the app is mounted under                 |
| `PUBLIC_URL`                    | `http://localhost:4000/civbuilder` | Used to build draft invite links                     |
| `CORS_ORIGINS`                  | empty                              | Comma-separated allowed origins; empty = same-origin |
| `CSP_UPGRADE_INSECURE_REQUESTS` | `true`                             | Set `false` when served over plain HTTP by hostname  |

`CSP_UPGRADE_INSECURE_REQUESTS` deserves a word. Left on, the browser rewrites
this origin's `http://` subresource requests to `https://` — right behind the
TLS-terminating proxy the site normally runs behind, and fatal without one:
every stylesheet and script fails the TLS handshake and the pages render dead.
Loopback is exempt from the upgrade, so a `localhost` smoke test will not show
the problem; reaching the app by hostname over plain HTTP will.

## Architecture

```
src/
  index.js              process entrypoint (listens, wires socket.io)
  app.js                Express application factory
  config.js             environment-driven configuration
  validation.js         input validation at the trust boundary
  errors.js             typed HTTP errors and the terminal error handler
  routes/               pages, mod generation, drafts, health probes
  middleware/           seat authentication, rate limiting
  services/
    command.js          the only place an external binary is invoked
    paths.js            path construction, confined to permitted roots
    drafts.js           draft persistence and seat tokens
    draft-logic.js      pure draft rules
    mod-data.js         pure preset/draft -> mod data mapping
    mod-scaffold.js     mod directory tree and packaging
    mod-builder.js      the generation pipeline
  sockets/draft.js      socket.io handlers

process_mod/            generation modules (names, tech trees, icons, strings)
modding/                C++ .dat rewriting (genieutils + jsoncpp)
public/                 client-side pages and game assets
  vendor/               third-party browser libraries, served from this origin
tests/                  Vitest unit and integration suites
e2e/                    Playwright end-to-end suites
```

`server.js` at the root remains as a thin compatibility shim re-exporting from
`src/`.

### How mod generation works

1. Validate the request's `seed` and build the mod directory tree.
2. Render civilization flags (randomly, from a palette, or from an upload).
3. Generate or assemble `data.json` describing every civilization.
4. Write modded strings, unit icons, tech trees and AI files.
5. Invoke the native `create-data-mod` binary to rewrite the game's `.dat`.
6. Package the result as a zip and remove the working tree.

Drafts follow the same path, sourcing steps 2–3 from the drafted player state
rather than from random generation. Draft state lives in `drafts/<id>.json`;
finished archives land in `modding/requested_mods/<id>.zip`.

### Reproducible generation

Generation is driven by a seeded PRNG (`process_mod/rng.js`) threaded through
the random modules, so the same seed produces the same mod. Modules default to
non-deterministic randomness when no generator is supplied.

## Testing

Two suites, run separately:

- **`npm test`** — Vitest. Unit and integration coverage of validation, path
  containment, draft rules, seeded generation, HTTP routes and socket
  authorization. Each test process gets an isolated `APP_DIR`.
- **`npm run test:e2e`** — Playwright. Drives a real browser against a real
  server: page loading and CSP, authoring and exporting a civilization,
  generating and downloading a mod, every HTTP endpoint, multiplayer drafting
  across independent browser contexts, and security properties mounted the way
  an attacker would.

`tests/exploits.test.js` is an adversarial battery covering command injection,
path traversal, zip slip, prototype pollution, denial-of-service bounds, header
injection, authorization bypass and mass assignment. A failure there is a
security regression.

The fixture stubs only the native `create-data-mod` binary; everything else is
the production code path. To run the E2E suite against a browser already
installed on the machine rather than one Playwright downloads:

```bash
CHROMIUM_PATH=/path/to/chrome npm run test:e2e
```

The same suite can run against a running instance — CI uses this to validate
the built container image, where the real binary and real game assets are
present:

```bash
E2E_BASE_URL=http://127.0.0.1:4000 npm run test:e2e
```

## Building and releasing

See [docs/RELEASING.md](docs/RELEASING.md). In short: the image is built by CI
on a self-hosted runner labelled `docker`, and a `v*` tag publishes a versioned
image to GHCR with an SBOM and build provenance, plus the native binary as a
release asset.

## Security

See [SECURITY.md](SECURITY.md) for the trust boundaries and how to report an
issue.

Three properties are worth knowing when changing this code:

- **External programs are invoked through `src/services/command.js` only**,
  which uses `execFile` with an argv array. Never reintroduce `exec` with an
  interpolated command string — user-controlled values reach this layer.
- **Draft seats are proved by a signed, httpOnly token**, never by a
  client-supplied player number. Socket handlers read the seat from the
  connection, not the message.
- **Browser libraries are served from this origin**, not a CDN. jQuery lives in
  `public/vendor/` and the Content-Security-Policy allows no third-party script
  source, so a compromised CDN cannot execute script here.

## Credits

The tech tree viewer under `public/aoe2techtree` is adapted from
[SiegeEngineers/aoe2techtree](https://github.com/SiegeEngineers/aoe2techtree)
by Hszemi, with modifications allowing tech trees to be edited and saved.

`.dat` file editing uses [genieutils](https://github.com/Tapsa/genieutils).

## License

MIT — see [LICENSE](LICENSE).
