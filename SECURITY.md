# Security

## Reporting a vulnerability

Please report security issues privately via GitHub's
[private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
rather than opening a public issue.

## Trust boundaries

Everything below arrives from an untrusted client and is validated before use.

| Input                              | Where it goes                        | Control                                                      |
| ---------------------------------- | ------------------------------------ | ------------------------------------------------------------ |
| `seed` (mod generation)            | filesystem paths, native binary argv | `^[A-Za-z0-9]{1,32}$`, plus path containment                 |
| `draftID`                          | filesystem paths                     | `^[0-9]{1,32}$`, plus path containment                       |
| `presets`, `modifiers`             | mod data document                    | JSON parsed behind a 400, shape normalised, numerics clamped |
| `civ_name`, `alias`, `description` | mod strings, draft state             | control characters stripped, length capped                   |
| Socket messages                    | draft state                          | seat derived from the connection's signed cookie             |
| Uploaded flag images               | mod archive                          | decoded as base64 into a fixed set of paths                  |

## Design rules

These exist because the code previously violated each of them.

### External programs are never invoked through a shell

`src/services/command.js` is the only place the application runs an external
binary, and it uses `execFile` with an argv array. There is no shell, so
metacharacters in arguments are inert. `tests/command.test.js` asserts this
directly.

Do not reintroduce `exec`, `execSync`, or `spawn` with `shell: true`. The mod
pipeline's directory and archive work is done with `fs` calls rather than shell
scripts for the same reason.

### Paths are validated _and_ contained

Identifier validation happens at the route boundary; `src/services/paths.js`
independently confirms that every constructed path resolves inside its
permitted root. Either control alone would be sufficient today, but the pair
means a future caller that forgets to validate still cannot escape.

### Authorization comes from the server, not the message

A draft seat is proved by an unguessable token stored server-side in the draft
and handed to the client as a **signed, httpOnly** cookie. The player number is
derived from that token. Socket connections resolve their seat once at
handshake time and ignore any seat the client asserts afterwards.

Seat tokens are stripped from every gamestate broadcast
(`drafts.toPublic`), so one player can never learn another's token.

Note that `cookie-parser`'s `signedCookie()` returns an unprefixed value
unchanged rather than rejecting it, so the `s:` prefix is checked explicitly
before unsigning.

### Browser libraries are served from this origin

jQuery is vendored in `public/vendor/` rather than loaded from a CDN, and the
Content-Security-Policy names no third-party script source. A compromised CDN
therefore cannot execute script on this origin. Add new browser libraries the
same way; do not widen `script-src`.

The policy is asserted from a real browser in `e2e/pages.spec.js`, which also
guards the opposite failure: a policy so strict it blocks the site's own
assets.

### Failures are contained

A terminal error handler converts thrown errors into status codes and never
leaks a stack trace or internal message to the client. Mod generation is rate
limited because each request drives a native rewrite of a ~10MB file plus a
zip.

## Operational requirements

- `COOKIE_SECRET` must be set to a strong random value in production; the app
  refuses to start in `NODE_ENV=production` without it.
- Run behind TLS. Seat cookies are marked `secure` when `NODE_ENV=production`.
- Set `TRUST_PROXY_HOPS` to the number of reverse proxies in front of the app
  so rate limiting keys on the real client IP.
- The container runs as a non-root user; only `drafts/` and
  `modding/requested_mods/` need to be writable.
- Generated archives accumulate in `modding/requested_mods`. Schedule
  `drafts/cleanup.sh` (or an equivalent) to remove stale drafts and mods.
