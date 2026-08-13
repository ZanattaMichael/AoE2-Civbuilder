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
| `npm test`              | Run the test suite                        |
| `npm run test:coverage` | Run tests with a coverage report and gate |
| `npm run lint`          | Lint with ESLint                          |
| `npm run format`        | Format with Prettier                      |

## Configuration

All configuration is environment-driven; see `.env.example` for the full list.
The ones that matter most:

| Variable        | Default                            | Notes                                                |
| --------------- | ---------------------------------- | ---------------------------------------------------- |
| `COOKIE_SECRET` | —                                  | **Required in production.** Signs seat cookies.      |
| `PORT`          | `4000`                             | Listen port                                          |
| `APP_DIR`       | repository root                    | Root for all derived paths                           |
| `BASE_PATH`     | `/civbuilder`                      | Path prefix the app is mounted under                 |
| `PUBLIC_URL`    | `http://localhost:4000/civbuilder` | Used to build draft invite links                     |
| `CORS_ORIGINS`  | empty                              | Comma-separated allowed origins; empty = same-origin |

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
tests/                  Vitest suites
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

## Security

See [SECURITY.md](SECURITY.md) for the trust boundaries and how to report an
issue.

Two properties are worth knowing when changing this code:

- **External programs are invoked through `src/services/command.js` only**,
  which uses `execFile` with an argv array. Never reintroduce `exec` with an
  interpolated command string — user-controlled values reach this layer.
- **Draft seats are proved by a signed, httpOnly token**, never by a
  client-supplied player number. Socket handlers read the seat from the
  connection, not the message.

## Credits

The tech tree viewer under `public/aoe2techtree` is adapted from
[SiegeEngineers/aoe2techtree](https://github.com/SiegeEngineers/aoe2techtree)
by Hszemi, with modifications allowing tech trees to be edited and saved.

`.dat` file editing uses [genieutils](https://github.com/Tapsa/genieutils).

## License

MIT — see [LICENSE](LICENSE).
