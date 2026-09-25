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
| `stable`       | 37 packages (as of Phase 6) — everything except `audit`/`embeddings`   | `0.2.0`               | `latest`       |
| `experimental` | `audit`, `embeddings`                                                   | `0.2.0-experimental`  | `experimental` |

The `experimental` group's membership isn't fixed across releases — Phase 5's `experimental` group
(`dynamodb`/`pinecone`/`qdrant`/`neo4j`/`mongodb`) promoted into `stable` and the group was removed
entirely once empty (Phase 6 item 4); Phase 6 re-added it from scratch for `audit`/`embeddings`
(item 9). Check `nx.json`'s `release.groups` for the current membership rather than assuming this
table stays in sync — it's a snapshot, not the source of truth.

**A new experimental package's first release is versioned `<current stable version>-experimental`,
not a hardcoded `0.1.0-experimental`.** `releaseTagPattern` is `v{version}`, which isn't group-aware
— two different, unrelated groups both landing on the literal string `0.1.0-experimental` at
different points in the project's history produces a real git tag collision (this happened: Phase
6 item 9 first tried `0.1.0-experimental` for `audit`/`embeddings`, following the PRD's original
Decision #3 literally, and hit `git tag v0.1.0-experimental` already taken by Phase 5's group).
Tying a new experimental package's version to the stable group's *current* version instead avoids
this structurally — `stable`'s version only ever climbs, so it can't repeat a prior tag the way a
hardcoded literal can whenever `experimental` empties out and refills with a different, unrelated
package set.

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

Before publishing to the real npm registry, rehearse the entire publish against a local one. Do
this **after** the real `nx release version` for both groups has already run locally (see
[Versioning](#versioning-local-before-every-real-release) below) — the rehearsal publishes whatever
version is currently on disk, so it should be exercising the actual version about to go out, not a
throwaway one.

### 1. Start Verdaccio

```bash
npx nx run @mantle/source:local-registry
```

Run this in the background or a separate terminal — it stays up for the rest of the rehearsal.
**This command also runs `npm config set registry http://localhost:4873/` and the yarn equivalent
against your *global* npm config**, not just this shell session — every `npm install`/`npm view`
you run afterward (in this repo or anywhere else on the machine) silently talks to the local
registry until you undo it. Don't skip the cleanup step at the end.

### 2. Publish both groups to it

```bash
npx nx release publish --groups=stable --tag=latest --registry=http://localhost:4873 --first-release
npx nx release publish --groups=experimental --tag=experimental --registry=http://localhost:4873 --first-release
```

`--first-release` here only matters for whichever group is genuinely publishing for the first time
(harmless no-op otherwise, since a not-yet-published version never trips the "does this already
exist" check regardless of the flag) — pass it for both if either one needs it, there's no per-group
toggle downstream in CI either (see [Publishing (CI)](#publishing-ci)).

### 3. Verify

Fresh install in an empty scratch directory (not this repo — you want to prove registry resolution,
not workspace-symlink resolution):

```bash
mkdir /tmp/verdaccio-check && cd /tmp/verdaccio-check && npm init -y
npm install @mantlejs/mantle @mantlejs/memory --registry http://localhost:4873
npm install @mantlejs/audit@experimental @mantlejs/embeddings@experimental --registry http://localhost:4873
```

Confirm the installed versions are what you expect (`cat node_modules/@mantlejs/mantle/package.json`),
then prove the installed packages actually work — a real CRUD round-trip, not just "it resolved":

```js
// smoke.mjs
import { mantle, RepositoryService } from "@mantlejs/mantle";
import { MemoryRepository } from "@mantlejs/memory";

class ItemsService extends RepositoryService {}
const app = mantle();
app.use("items", new ItemsService(new MemoryRepository()));
const svc = app.service("items");
const created = await svc.create({ name: "verdaccio-smoke" });
const found = await svc.get(created.id);
if (found.name !== "verdaccio-smoke") throw new Error("CRUD round-trip failed");
console.log("PASS:", found);
```

Then re-run `create-mantlejs`'s own e2e smoke test against the rehearsal registry instead of the
workspace — it already supports this via an env var, no separate script needed:

```bash
MANTLE_REGISTRY=http://localhost:4873 node packages/create-mantlejs/e2e/scaffold-smoke.mjs
```

This scaffolds a real app, `npm install`s it from the given registry (instead of linking
`file:../../packages/*`), builds, tests, boots on an ephemeral port, does a CRUD round-trip over
HTTP, sends `SIGTERM`, and asserts a clean exit — the same script the `create-mantlejs:e2e-scaffold`
Nx target runs, just registry-redirected.

### 4. Clean up

```bash
pkill -f verdaccio          # stop the local registry
npm config delete registry  # undo the global registry override from step 1
rm -rf tmp/local-registry/storage  # discard rehearsal state — git-ignored, safe to delete
```

Confirm `npm config get registry` prints `https://registry.npmjs.org/` again before doing anything
else — an easy step to forget, and every subsequent `npm install` anywhere on the machine silently
targets the rehearsal registry until you do.

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
version into every project's `package.json` in the group and stages the changes with git — it does
**not** touch peerDependencies itself (see below), which is why step 1 has to happen first, so both
land together. **It does not commit or tag by default in this workspace** — `nx.json`'s
`release.version` config has no `git` block, so `--git-commit`/`--git-tag` aren't implied. (Nx's own
`--help` doesn't show a default for either flag; `docs/releasing.md` used to claim otherwise —
confirmed wrong live during Phase 6 item 9's real release, where `nx release version` staged the
changes but left them uncommitted.) Commit and tag it yourself:

```bash
git commit -m "chore(release): publish <version>"
git tag -a v<version> -m "v<version>"
```

Review the diff before committing. **Check the tag doesn't already exist first** (`git tag | grep
v<version>`) — `releaseTagPattern` is `v{version}`, not group-aware, so two different release groups
that happen to land on the same version string at different points in the project's history will
collide (this happened for real in Phase 6 item 9 — see the `experimental` group note in
[Overview](#overview)). Then:

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

### `examples/*` dependency ranges

`examples/*` isn't in either release group, but every example's `package.json` still declares
`@mantlejs/*` dependencies at some range, and `examples/knowledge-base/*` is inside the npm
workspace (`workspaces` in the root `package.json`) — so these ranges matter too, just on a
different clock than the peer-range step above. **Bump them only *after* the real `nx release
version` for the relevant group has landed on disk, never before**, confirmed the hard way in Phase
6 item 9:

- Bump the examples' ranges *before* the real version lands, and `@nx/dependency-checks` lint fails
  with "the installed version of X doesn't satisfy the declared range" — the packages in
  `node_modules` are still the old version, so the now-too-new declared range is genuinely
  unsatisfied.
- Run the real `nx release version`'s lockfile-update step (`npm install --package-lock-only`)
  *before* bumping an example's range for a package that has **never been published to the real
  registry before** (a brand-new experimental package, e.g. `@mantlejs/embeddings` in this phase),
  and it hard-fails: the stale range can't be satisfied by the now-newer local workspace package,
  and npm's fallback — checking the real registry — 404s, because nothing has ever been published
  there under that name. (For an already-published package like `@mantlejs/mantle`, the same stale
  range doesn't hard-fail the same way — the real registry genuinely has an old version to fall back
  to — but it's still wrong to leave it stale, just less loudly wrong.)

So: run `nx release version` for real first, *then* bump every `examples/*/package.json`'s
`@mantlejs/*` ranges to match, then `npm install` at the repo root to re-settle the lockfile and
`node_modules` against the new ranges, then re-run `nx run-many -t build,test,lint,typecheck` to
confirm.

**Stray nested `node_modules` will masquerade as a version problem.** If any `examples/*` directory
has its own `node_modules/@mantlejs/*` (gitignored, so invisible to `git status` — can happen from
an earlier standalone `npm install` run directly inside that directory, before or outside the normal
workspace-wide install), it shadows the hoisted top-level workspace symlink for anything resolving
from inside that directory. This surfaces as a **very misleading** `@nx/dependency-checks` "package
is not used" error (not a version-mismatch message) once a version bump makes the stale nested copy
actually invalid. Check with `npm ls @mantlejs/mantle` from inside the example directory — a real,
non-symlinked local version (not `-> ./packages/mantle`) means a stray copy exists. Fix: delete the
nested `node_modules`, `npm install` from the repo root to let it re-hoist, then `npx nx reset` — the
project graph cache computed while the stray copy existed doesn't self-invalidate just because you
fixed `node_modules` after the fact.

### Local `build`/`typecheck` passing isn't proof CI will

**`npx nx reset` does not clear a package's own `dist/` output or `tsconfig.*.tsbuildinfo`
incremental-build state — only Nx's own task cache.** Confirmed the hard way in Phase 6 item 9: a
real CI run (`release-publish.yml`, `dry_run: false`) failed its `build, test, lint, typecheck` step
with three genuine `tsc` errors — two test files mocking `AuthEngine` that predated an interface it
grew a phase earlier, one predating a new required field on `RepositoryCapabilities` — that had been
sitting in committed `main` for multiple prior commits, through several `npx nx reset` + full
`nx run-many -t build,test,lint,typecheck` passes locally that all reported green. `npm ci` +
a genuinely fresh git checkout (what CI does) has none of a long-running local session's accumulated
`dist/`/`.tsbuildinfo` state to lean on; a long local session apparently can, silently.

Before trusting a local green run enough to publish for real, reproduce what CI actually does:

```bash
find packages -name "*.tsbuildinfo" -delete
find packages -maxdepth 2 -type d \( -name dist -o -name out-tsc \) -exec rm -rf {} +
npx nx reset
npx nx run-many -t build,test,lint,typecheck
```

If that's still green, a local run is finally as trustworthy as CI's — anything short of it isn't,
no matter how many times `nx reset` alone was re-run in between.

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

```bash
gh workflow run "Release publish" --ref main -f dry_run=false -f first_release=true
```

`first_release` applies to both groups in one run — there's no per-group toggle in the workflow
(see its `dry_run`/`first_release` inputs above). Pass `true` if *either* group needs it; it's a
harmless no-op for a group that doesn't (see [Local rehearsal](#local-rehearsal-verdaccio) step 2).
Turn it off entirely (`first_release=false`) once both groups have had at least one real publish.

**If an AI agent is doing the release work: triggering this workflow with `dry_run: false` is a
real-world action the agent's own tooling may refuse to take even with your explicit go-ahead in
chat**, separately from any approval you give it — Claude Code's auto-mode permission classifier
blocks `gh workflow run` here as "Create Public Surface" regardless of context. This is expected,
not a bug to route around — trigger it yourself (the command above, or the Actions tab UI) rather
than asking the agent to find another way in.

Provenance (`NPM_CONFIG_PROVENANCE: true`, `id-token: write` permission) is always requested — it
only produces a real attestation on GitHub-hosted runners with OIDC, which is what this workflow
uses.

---

## Post-release verification

Once the workflow completes with `dry_run: false`, confirm the real registry actually has what was
just published — the workflow succeeding means `npm publish` didn't error, not that the published
packages actually work for a consumer. From an empty scratch directory (not this repo):

```bash
mkdir /tmp/release-check && cd /tmp/release-check && npm init -y
npm install @mantlejs/mantle @mantlejs/memory   # every stable package should resolve this way
npm install @mantlejs/audit@experimental @mantlejs/embeddings@experimental
```

Then the same two live checks as the Verdaccio rehearsal (step 3 there), just without
`--registry`/`MANTLE_REGISTRY` — a real CRUD round-trip against the installed `mantle`+`memory`, and
`node packages/create-mantlejs/e2e/scaffold-smoke.mjs` run with no env var override (it defaults to
the real registry). Also worth doing once per release, not just the first: re-point one already-built
example (e.g. `todo-minimal`) at the registry versions instead of the workspace `file:` links and
confirm it still boots — catches a class of bug the workspace-linked dev environment can't, since
`file:` links never go through npm's actual package resolution/packing.

---

## GitHub release notes

`nx release changelog` can't create a GitHub Release for this workspace — it disables workspace-level
changelog generation (and therefore release creation) outright whenever more than one release group
is configured, which is exactly this repo's `stable`/`experimental` split (confirmed during Phase 5's
first real release, item 12). Write release notes by hand and publish via `gh release create`
directly, once per tag:

```bash
gh release create v0.2.0 --title "v0.2.0" --notes "..."
gh release create v0.2.0-experimental --title "v0.2.0-experimental" --notes "..." --prerelease
```

Mark the `experimental` group's release `--prerelease` — it's a real, intentional npm dist-tag
distinction (`experimental` vs `latest`), and the GitHub release should carry the same signal.
`gh release create` is the same category of real-world, public action as triggering the publish
workflow above — if an agent is doing this work, expect it to ask for the same kind of explicit
go-ahead rather than running it unprompted.

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

**Any minor or major bump needs `bump-peer-ranges.mjs` first — don't assume an existing `^0.1.0`
range already covers it.** Under npm's caret semantics, a `0.x.y` version is special: `^0.1.0` means
`>=0.1.0 <0.2.0`, i.e. patch-level updates only within `0.1.x` — it does **not** cover `0.2.0`.
Confirmed live (Phase 6 item 9): dry-running `nx release version --specifier=minor --groups=stable`
without bumping peer ranges first fails immediately with `preserveMatchingDependencyRanges` on the
very first cross-package peer range it checks. This only stops mattering once a group's major is
`1` or higher (`^1.1.0` *does* cover `1.2.0`) — every `@mantlejs/*` package is still `0.x`, so treat
every bump, patch included, as needing the peer-range step; the patch case is simply already
satisfied by an existing `^0.1.0` range, not exempt from the check. If `nx release version` stops
with a `preserveMatchingDependencyRanges` error, it's telling you a peer range needs a bump before
the release can proceed — run `bump-peer-ranges.mjs` for the group in question and re-run.

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
| `git tag v<version>` fails with "already exists"                     | Two different release groups landed on the same version string at different points in history — `releaseTagPattern` isn't group-aware | Pick a version for the newer release that hasn't been used before; see the `experimental` group note in [Overview](#overview) |
| `nx release version` "succeeds" but nothing was committed/tagged     | This workspace's `nx.json` has no `release.version.git` block, so `--git-commit`/`--git-tag` aren't on by default | Commit and tag it yourself — see [Versioning](#versioning-local-before-every-real-release) |
| `@nx/dependency-checks` lint fails with "package is not used" on an `examples/*` project, right after a version bump | A stray, un-hoisted `node_modules/@mantlejs/*` inside that example directory is shadowing the workspace symlink | See [`examples/*` dependency ranges](#examples-dependency-ranges) |
| `nx release version`'s lockfile-update step 404s on a package that was never published before | An `examples/*/package.json` still declares the *old* range for that package, and the old range can't be satisfied locally (already bumped) or from the registry (never published) | Bump that example's range to the new version *after* (not before) the real version bump lands — see [`examples/*` dependency ranges](#examples-dependency-ranges) |
| An agent's `gh workflow run ... -f dry_run=false` for the publish workflow is refused despite your go-ahead | Claude Code's own auto-mode permission classifier, not the agent declining — "Create Public Surface" actions need you to trigger them directly | Run the command yourself, or use the Actions tab UI — see [Publishing (CI)](#publishing-ci) |
| CI's `build, test, lint, typecheck` step fails on `tsc` errors a local run never showed | A long-running local session's leftover `dist/`/`.tsbuildinfo` masked a real, already-committed error — `nx reset` alone doesn't clear those | Reproduce CI's clean-slate build locally before trusting green — see [Local `build`/`typecheck` passing isn't proof CI will](#local-buildtypecheck-passing-isnt-proof-ci-will) |
