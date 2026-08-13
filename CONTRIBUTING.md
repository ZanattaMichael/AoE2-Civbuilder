# Contributing

## Setup

Node 22 is required (`.nvmrc`).

```bash
npm ci
npm test
```

## Before opening a pull request

```bash
npm run lint
npm run format
npm run test:all
```

CI runs the same checks plus `npm audit` and a Docker build.

The end-to-end suite needs a browser. Playwright downloads one on first use
(`npx playwright install chromium`), or point it at an existing install:

```bash
CHROMIUM_PATH=/path/to/chrome npm run test:e2e
```

## Conventions

- **CommonJS** throughout `src/` and `process_mod/`. Test files use ESM
  `import` because Vitest's API is ESM-only.
- **Tabs** for indentation in JavaScript; two spaces in JSON, YAML and
  Markdown. Prettier and `.editorconfig` enforce this.
- New server-side code goes in `src/` and is held to the full ESLint rule set.
  `public/js` and `process_mod` carry legacy style and are linted more loosely.

## Where things belong

| Adding...              | Goes in                          |
| ---------------------- | -------------------------------- |
| An HTTP endpoint       | `src/routes/`                    |
| Request pre-processing | `src/middleware/`                |
| Business logic         | `src/services/`                  |
| A socket event         | `src/sockets/draft.js`           |
| Game rules with no I/O | `src/services/draft-logic.js`    |
| Configuration          | `src/config.js` + `.env.example` |

Keep game rules pure and free of I/O — that is what makes them testable.

## Testing

Tests live in `tests/` and run under Vitest. Each test process gets its own
temporary `APP_DIR` (see `tests/setup.js`), including a stub `create-data-mod`
binary, so suites never touch your working tree.

Coverage thresholds are enforced by `npm run test:coverage`. Please add tests
alongside behaviour changes, particularly for anything touching validation,
path construction, or authorization.

To see server logs while debugging a test:

```bash
LOG_LEVEL=debug npx vitest run tests/routes.test.js
E2E_LOG_LEVEL=debug npm run test:e2e
```

### End-to-end tests

`e2e/` drives a real browser against a real server process started by
`e2e/fixture-server.js`, which builds a throwaway `APP_DIR` with placeholder
art and a stub `create-data-mod`. Add a spec here when a change spans the
client, the cookie layer and the server — the seams unit tests cannot reach.
The Content-Security-Policy regression that blocked the site's own jQuery is
the archetype: every layer was individually correct.

Third-party origins are blocked in these tests, so a spec must not depend on a
CDN being reachable. Add browser libraries to `public/vendor/` instead.

## Security-sensitive areas

Read [SECURITY.md](SECURITY.md) before changing:

- `src/services/command.js` — never invoke a shell
- `src/services/paths.js` and `src/validation.js` — the trust boundary
- `src/middleware/auth.js` and `src/sockets/draft.js` — seat authorization
