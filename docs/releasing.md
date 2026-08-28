# Releasing Mantle JS

Operational runbook for the npm publish pipeline. For the release *plan* (tiering rationale, what
ships when), see the [Phase 5 PRD](./planning/mantle-js-phase-5-prd.md#release-plan) and
[checklist](./planning/mantle-js-phase-5-checklist.md) item 9. This doc is the "how do I actually
run it" companion.

---

## Overview

Publishing is handled by [`nx release`](https://nx.dev/features/manage-releases), configured in
`nx.json` with two **fixed** release groups that version and publish independently:

| Group          | Projects                                                                | Version              | npm dist-tag   |
| -------------- | ------------------------------------------------------------------------ | --------------------- | -------------- |
| `stable`       | 31 packages — everything except the five below                          | `0.1.0` (first release) | `latest`       |
| `experimental` | `dynamodb`, `pinecone`, `qdrant`, `neo4j`, `mongodb`                     | `0.1.0-experimental`  | `experimental` |

"Fixed" means every project within a group always shares the same version number — bumping one
bumps all of them together. The two groups are otherwise independent: releasing `stable` never
touches `experimental`'s version, and vice versa.

Every package's `peerDependencies` on other `@mantlejs/*` packages must stay compatible with the
version being released — see [Peer dependency ranges](#peer-dependency-ranges) below.

---

## One-time setup (already done)

This section exists for reference / disaster recovery — you don't need to redo it unless
starting over on a new npm account.

1. **npm account + `@mantlejs` org** — confirmed via `npm whoami` / `npm org ls mantlejs`.
2. **2FA** — enabled at the `auth-and-writes` level (npmjs.com → Account → Two-Factor
   Authentication).
3. **Granular Access Token** — npmjs.com → Account → Access Tokens → Generate New Token →
   Granular Access Token, scoped to the `@mantlejs` packages only, **Read and write** permission,
   with an expiration date.
4. **GitHub repo secret** — the token's value is stored as `NPM_TOKEN` under the `MantleJs/mantle`
   repo's Settings → Secrets and variables → Actions. The publish workflow
   (`.github/workflows/release-publish.yml`) reads it from there; nothing in the workflow file
   itself needs to change when the token is rotated.

---

## Rotating the npm token

**Granular Access Tokens hard-expire with no grace period.** Once the expiration date passes, any
publish attempt using it fails immediately with an auth error — there's no warning window and no
way to extend an existing token's lifetime.

To rotate:

1. npmjs.com → Account → Access Tokens → **Generate New Token** → Granular Access Token
2. Same scope as before: `@mantlejs` packages only, Read and write, pick a new expiration
3. GitHub → repo Settings → Secrets and variables → Actions → click **`NPM_TOKEN`** → **Update** →
   paste the new value
4. Old token can be revoked from npmjs.com once the new one is confirmed working (optional — it'll
   expire on its own regardless)

Nothing else changes — no workflow edits, no code changes. The `NPM_TOKEN` secret name is fixed;
only its value rotates.

**Practical note:** if you set a short expiry (e.g. 7 days) for early testing, mint a longer-lived
token before the actual first publish (checklist item 12) — you don't want the token expiring
mid-release.

---

## Local rehearsal (Verdaccio)

Before publishing to the real npm registry, rehearse against a local registry:

```bash
# Terminal 1 — start Verdaccio
npx nx run @mantle/source:local-registry

# Terminal 2 — version + publish against it
npx nx release version 0.1.0 --groups=stable --first-release
npx nx release version 0.1.0-experimental --groups=experimental --first-release
npx nx release publish --groups=stable --tag=latest --registry=http://localhost:4873 --first-release
npx nx release publish --groups=experimental --tag=experimental --registry=http://localhost:4873 --first-release
```

Then verify: `npm install @mantlejs/mantle --registry http://localhost:4873` in a scratch
directory, and re-run the CLI smoke test / `todo-minimal` example against the rehearsal registry
(checklist item 12).

Discard the rehearsal registry's state (`tmp/local-registry/storage`) before the real run — it's
git-ignored and safe to delete.

---

## Versioning (local, before every real release)

Version bumps, changelog generation, and git tagging happen **locally**, not in CI — a human picks
the version number and reviews the diff before anything is pushed. **Bump peer ranges first** —
`nx release version` will refuse to run otherwise (see [Peer dependency ranges](#peer-dependency-ranges)):

```bash
# 1. Bump every internal @mantlejs/* peerDependency range that points at this group to the
#    target version, workspace-wide (including packages in OTHER groups that depend on this one —
#    e.g. experimental's dynamodb depends on stable's mantle).
node tools/bump-peer-ranges.mjs stable <version>

# 2. Pick a specifier: an exact version ("0.1.0") or a semver keyword (patch/minor/major/etc.)
npx nx release version <specifier> --groups=stable
```

Repeat both steps for `experimental` with its own version. `nx release version` writes the new
version into every project's `package.json` in the group, commits, and tags (`v{version}`) by
default — it does **not** touch peerDependencies itself (see below), which is why step 1 has to
happen first, in the same commit. Review the diff, then:

```bash
git push && git push --tags
```

Add `--first-release` only for the very first release of a group (skips assuming a previous git
tag / registry version exists).

**Don't run `bump-peer-ranges.mjs` ahead of time, outside of this two-step flow.** Bumping a peer
range before the package it points at is actually released breaks `npm install`/`npm ci`
workspace-wide — nothing (not the local workspace link, not the registry, since the package hasn't
published at that version yet) can satisfy the new range. This happened once already: see the
[postmortem](#postmortem-premature-peer-range-bump) below.

---

## Publishing (CI)

The real publish runs via the **`Release publish`** GitHub Actions workflow
(`.github/workflows/release-publish.yml`), triggered manually from the Actions tab — it never runs
on push. It builds, tests, lints, typechecks, and runs `check-publish-fields` before publishing
either group.

Two inputs, both default to the safe option:

| Input           | Default | Effect                                                                 |
| --------------- | ------- | ----------------------------------------------------------------------- |
| `dry_run`       | `true`  | When `true`, nothing is published — pipeline runs end-to-end as a check |
| `first_release` | `true`  | Skips the "does this version already exist" registry check — turn off after the first real publish |

**To rehearse the CI pipeline itself** (safe — no real publish): trigger the workflow with
`dry_run: true` (the default) and confirm it completes green.

**To actually publish:** run `nx release version` locally first (previous section), push the tag,
then trigger the workflow with `dry_run: false`.

Provenance (`NPM_CONFIG_PROVENANCE: true`, `id-token: write` permission) is always requested — it
only produces a real attestation on GitHub-hosted runners with OIDC, which is what this workflow
uses.

---

## Peer dependency ranges

Every package that depends on another `@mantlejs/*` package as a `peerDependency` must declare a
range that covers the version about to be released. Nx enforces this: `preserveMatchingDependencyRanges`
blocks `nx release version` if a peer range doesn't already cover the new version — and critically,
it **never auto-rewrites the range for you**, under any `updateDependents` setting. This is
deliberate on Nx's part: a peerDependency range is a consumer-facing compatibility promise, not
something a tool should silently widen. `tools/bump-peer-ranges.mjs` (see
[Versioning](#versioning-local-before-every-real-release) above) exists to make satisfying this
guard a single safe command instead of hand-editing 30+ `package.json` files.

When bumping to a new minor/major (e.g. `0.1.0` → `0.2.0`), check whether existing `^0.1.0` ranges
still cover it (they do, under normal caret semantics, since both share the same major and neither
is `0.x` in a way that breaks caret behavior once past `0.1.0` — `0.0.x` is the special case that
doesn't compose with caret ranges the way `0.1.x`+ does). If `nx release version` stops with a
`preserveMatchingDependencyRanges` error, it's telling you a peer range needs a bump before the
release can proceed — run `bump-peer-ranges.mjs` for the group in question and re-run.

### Postmortem: premature peer-range bump

While first setting this pipeline up, every internal peer range was bumped from `^0.0.1` to
`^0.1.0` **before** actually running `nx release version` — done to unblock a `--dry-run` test of
the guard above, then accidentally left committed. Since every package was still really `0.0.1` on
disk (no real version bump had happened), nothing could satisfy the new `^0.1.0` ranges — not the
local workspace link, not the registry (nothing has ever been published). Every `npm install`/`npm
ci` in the repo broke, including in the CI workflow's dry run, with `ETARGET
No matching version found for @mantlejs/mantle@^0.1.0`.

Fixed by reverting every range back to `^0.0.1` (matching reality) and moving the bump into
`bump-peer-ranges.mjs`, to be run as step 1 of the real versioning flow — atomically with the
actual version bump it's paired with, never ahead of it.

---

## Cross-group version cascading

`nx.json`'s `release.version.updateDependents` is set to `"never"`. Without this, versioning the
`stable` group cascades a version bump into the *actual version field* of any `experimental`
package that has a `peerDependency` on a stable package (e.g. `dynamodb` depends on
`@mantlejs/mantle`) — which would silently overwrite `dynamodb`'s own version to match `stable`'s
release, instead of leaving it for its own group's `experimental` release. Don't remove this
setting without re-verifying both groups version independently (`nx release version <specifier>
--groups=<name> --dry-run`, confirm only that group's projects appear in the output).

---

## Troubleshooting

| Symptom                                                             | Cause                                                                 | Fix |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------ | --- |
| `nx release version` fails with a `preserveMatchingDependencyRanges` error | A peer range doesn't cover the new version                           | See [Peer dependency ranges](#peer-dependency-ranges) |
| CI publish step fails with a 401/403                                | `NPM_TOKEN` expired or was revoked                                    | See [Rotating the npm token](#rotating-the-npm-token) |
| `experimental` packages' version changed when only `stable` was released | `updateDependents` isn't `"never"` — check `nx.json`                 | See [Cross-group version cascading](#cross-group-version-cascading) |
| npm publish rejects a version as already existing                    | Trying to republish a version already on the registry (safe failure mode — npm never lets you overwrite a published version) | Bump the version and re-run `nx release version` |
