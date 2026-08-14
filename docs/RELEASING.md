# Build and release process

## What gets built

| Artifact                 | Built by                   | Published to             |
| ------------------------ | -------------------------- | ------------------------ |
| Container image          | `Dockerfile` (multi-stage) | `ghcr.io/<owner>/<repo>` |
| `create-data-mod` binary | `modding/scripts/build.sh` | GitHub release asset     |
| Node application         | none — runs from source    | inside the image         |

The Node application is not compiled; the only compilation step is the C++
`create-data-mod` binary, which the image builds in a throwaway stage.

## Building locally

```bash
# The container, exactly as CI builds it
npm run docker:build

# Or run it with compose
COOKIE_SECRET=$(openssl rand -hex 32) npm run docker:run

# Just the native binary (needs a C++ toolchain)
npm run build:native
npm run build:native:clean   # discard the build directory first
```

`build:native` initialises the `genieutils` submodule if it is missing. It
requires:

```bash
sudo apt-get install build-essential cmake libjsoncpp-dev \
    zlib1g-dev liblz4-dev libboost-iostreams-dev
```

## Verifying a change

```bash
npm run verify   # lint, format check, unit tests with coverage, end-to-end
```

CI runs the same checks plus a dependency audit, an image build with a boot
check, and the end-to-end suite against the built image.

## Cutting a release

Releases are tag-driven. The tag must match `package.json`, and the release
workflow fails if it does not.

1. Move the `Unreleased` section of `CHANGELOG.md` under the new version.
2. Bump the version and tag:

   ```bash
   npm version minor      # or patch / major — creates the commit and tag
   git push --follow-tags
   ```

3. The `Release` workflow then:
   - re-runs lint, format, unit tests and the end-to-end suite;
   - checks the tag against `package.json`;
   - builds and pushes the image to GHCR tagged `X.Y.Z`, `X.Y`, `X`;
   - attaches an SBOM and build provenance attestation;
   - smoke-tests the published image by digest, waiting for `/readyz`;
   - builds and uploads the native binary with a SHA-256 checksum;
   - publishes a GitHub release with notes generated from the commit log.

To re-run a release for an existing tag, use the workflow's manual trigger and
supply the tag name.

## Versioning

[Semantic Versioning](https://semver.org). For this project:

- **Major** — a change requiring operator action: a new required environment
  variable, a changed socket protocol, a removed endpoint.
- **Minor** — new functionality that is backwards compatible.
- **Patch** — fixes and security updates that need no operator action.

Security fixes are released as soon as they are ready rather than being held
for a scheduled release.

## Runners

Image builds run on a self-hosted runner that provides a Docker daemon.
Everything else runs on GitHub-hosted `ubuntu-latest`.

The runner is selected by label, defaulting to `docker`. If your runner is
registered under a different label, set the repository variable
`DOCKER_RUNNER_LABEL` (Settings → Secrets and variables → Actions → Variables)
rather than editing each workflow.

If those jobs sit in `queued` and never start, no online runner carries the
label. Check Settings → Actions → Runners: the runner must be **idle** (not
offline), carry the expected label, and — if it belongs to a runner group — the
group must grant access to this repository.

Because a self-hosted runner may execute jobs concurrently and keeps state
between runs:

- containers are named per run and publish to a Docker-assigned host port;
- every job removes its container in an `always()` step;
- the buildx layer cache lives on the runner's disk and is rotated each run.

## Deploying the image

```bash
docker run -d \
  --name civbuilder \
  -e COOKIE_SECRET="$(openssl rand -hex 32)" \
  -e PUBLIC_URL="https://example.com/civbuilder" \
  -e TRUST_PROXY_HOPS=1 \
  -p 4000:4000 \
  -v civbuilder-drafts:/app/drafts \
  -v civbuilder-mods:/app/modding/requested_mods \
  ghcr.io/<owner>/<repo>:latest
```

Both volumes must be writable by uid `node` (1000). See `.env.example` for
every supported variable and `SECURITY.md` for the operational requirements.
