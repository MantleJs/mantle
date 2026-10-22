## What and why

<!-- What does this change, and what problem does it solve? Link the issue it closes, e.g. "Closes #123". -->

## How it was tested

<!-- Specs added or changed, and anything you checked by hand. -->

## Checklist

- [ ] `npx nx run-many -t build,test,lint,typecheck` passes locally (or `npx nx affected -t build,test,lint,typecheck`)
- [ ] New behavior has co-located `*.spec.ts` tests
- [ ] Package READMEs (and `CLAUDE.md`, for core interfaces) are updated for any API or behavior change
- [ ] A new package or a new `@mantlejs/*` dependency is reflected in `CLAUDE.md`'s dependency matrix **and**
      `dependencyMatrix` in `eslint.config.mjs` (`npm run check-dependency-matrix` passes)
- [ ] Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat(knex): …`, `fix(mcp): …`)
