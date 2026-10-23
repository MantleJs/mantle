# Contributing to Mantle JS

Thanks for helping build Mantle. This guide covers setting up the repo, the commands you'll use, and the few
rules the codebase enforces. By taking part you agree to follow the [Code of Conduct](./CODE_OF_CONDUCT.md).

- **Found a bug or want a feature?** Open an [issue](https://github.com/MantleJs/mantle/issues/new/choose). For
  anything bigger than a small fix, please open an issue before the pull request so we can agree on the design.
- **Found a security problem?** Don't open an issue — see [SECURITY.md](./SECURITY.md).

## Setup

You need **Node.js 22 or newer** and **npm 11.5 or newer** (older npm 11 releases crash resolving the workspace's
peer dependencies: `npm install -g npm@latest`).

```bash
git clone https://github.com/MantleJs/mantle.git
cd mantle
npm ci
npx nx run-many -t build,test,lint,typecheck   # the same checks CI runs
```

Specs that need a real Postgres skip themselves unless `MANTLE_PG_URL` is set, for example:

```bash
docker run --rm -e POSTGRES_PASSWORD=pg -p 55432:5432 postgres:16-alpine
MANTLE_PG_URL=postgres://postgres:pg@127.0.0.1:55432/postgres npx nx test knex
```

## Repository layout

| Path        | What lives there                                                                               |
| ----------- | ---------------------------------------------------------------------------------------------- |
| `packages/` | The published `@mantlejs/*` packages and `create-mantlejs`                                     |
| `examples/` | Runnable example apps (not published)                                                          |
| `registry/` | Mantle UI — React Aria blocks served as a shadcn registry                                      |
| `website/`  | mantlejs.com (Astro Starlight). Package READMEs are pulled into the site, so they are the docs |
| `docs/`     | Planning docs (PRDs, checklists) and the [release runbook](./docs/releasing.md)                |

[`CLAUDE.md`](./CLAUDE.md) is the architecture reference: the layer model, the core interfaces, and the package
dependency matrix. It's written for AI coding assistants, and it's the quickest way for a human to get oriented too.

## Everyday commands

The monorepo is managed with [Nx](https://nx.dev). Projects are named after their folder (`packages/knex` → `knex`).

```bash
npx nx test knex                            # test one project
npx nx build mantle                         # build one project (and what it depends on)
npx nx affected -t build,test,lint,typecheck # only what your branch changed
npx nx run-many -t lint                     # lint everything
npx nx graph                                # visualize the project graph
npm run check-dependency-matrix             # CLAUDE.md table vs eslint vs package.json deps
npm run check-package-metadata              # LICENSE + homepage on every package
```

Generate a new package with the Nx library generator rather than by hand:

```bash
NX_DAEMON=false npx nx g @nx/js:library --name=<name> --directory=packages/<name> \
  --bundler=tsc --unitTestRunner=vitest --linter=eslint --publishable --importPath=@mantlejs/<name>
```

Then copy the root `LICENSE` into the package, set `"homepage": "https://mantlejs.com/packages/<name>/"`, add it
to a release group in `nx.json` (new packages start in `experimental`), and update the dependency matrix (below).

## Rules the codebase enforces

- **Dependencies point inward.** Which `@mantlejs/*` package may import which is fixed by the dependency matrix in
  `CLAUDE.md`. ESLint enforces it, and `npm run check-dependency-matrix` (run in CI) fails if the table, the
  `dependencyMatrix` export in `eslint.config.mjs`, the project tags, and the `package.json` dependencies drift
  apart. **When you add a package or a dependency between packages, edit the table and `dependencyMatrix`
  together.**
- **Services depend on interfaces.** A service talks to `Repository<T>`, never to a concrete adapter, and holds no
  HTTP- or database-specific logic.
- **Hooks are plain functions** — no classes.
- **Errors are typed.** Throw a `MantleError` subclass (`BadRequest`, `NotFound`, `Conflict`, …), never `new Error()`.
- **No `any`.** Use `unknown` and narrow it.
- **Each package exports only from `src/index.ts`.**
- **Dates are serialized as RFC 3339** (ISO 8601 with a `Z` or offset, e.g. `2026-10-21T14:03:00.000Z`) — use
  `Date#toISOString()`, never locale formats or epoch numbers in API output.
- **Formatting** is Prettier: double quotes, semicolons, trailing commas, 120-character lines. Format only the
  lines you change — don't reformat whole files in a feature PR.

## Tests

Vitest specs live next to the code they test as `*.spec.ts`. Every behavior change needs a spec. Adapter
behavior that must match across backends has shared conformance fixtures in `@mantlejs/mantle`
(`NESTED_QUERY_CASES`, `TRANSPORT_CONFORMANCE_CASES`) — run new adapters or transports against them.

## Commits and pull requests

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/), scoped to the package:

```text
feat(knex): support $ilike on dot-path fields
fix(dynamodb): save() throws Conflict instead of overwriting
docs(mcp): document layered tool mode
```

Common types: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `ci`. Keep each pull request to one change, fill in
the template, and make sure CI is green. Update the package README in the same PR as the behavior it documents.

Releases are cut by the maintainers — see [docs/releasing.md](./docs/releasing.md).

## License

By contributing, you agree that your contributions are licensed under the [MIT License](./LICENSE).
