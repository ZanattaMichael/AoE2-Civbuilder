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
npm test
```

CI runs the same checks plus `npm audit` and a Docker build.

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
```

## Security-sensitive areas

Read [SECURITY.md](SECURITY.md) before changing:

- `src/services/command.js` — never invoke a shell
- `src/services/paths.js` and `src/validation.js` — the trust boundary
- `src/middleware/auth.js` and `src/sockets/draft.js` — seat authorization
