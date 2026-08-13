# Vendored browser libraries

Third-party JavaScript served from this origin rather than a CDN.

Loading these from a CDN would mean a compromise there could execute arbitrary
script on this site, and would require widening the Content-Security-Policy's
`script-src` to a third-party host. Both are avoided by committing the files.

| File             | Package  | Version | Source                                    |
| ---------------- | -------- | ------- | ----------------------------------------- |
| `jquery.min.js`  | `jquery` | 3.7.1   | `node_modules/jquery/dist/jquery.min.js`  |

To update: bump the version in `package.json` devDependencies, run
`npm install`, then copy the file across and re-run `npm run test:e2e`.
The devDependency exists so Dependabot flags advisories against the vendored
copy; nothing imports it at runtime.
