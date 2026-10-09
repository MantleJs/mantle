# mantlejs.com

The Mantle JS website: an [Astro Starlight](https://starlight.astro.build) site, deployed to GitHub Pages at
[mantlejs.com](https://mantlejs.com). Unpublished — an app in this workspace (`type:app`), never depended on.

```bash
npx nx run website:build     # builds @mantlejs/client + react and the UI registry first; output in website/dist
npx nx run website:dev       # http://localhost:4321 (the registry at /r/ is only copied in by build)
npx nx run website:preview   # serve the last build
```

## Where the content comes from

Nothing about a package is written twice. The site **reads** the repository at build time:

| Section            | Source                                                                                                                |
| ------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Guides             | `src/content/docs/**` — authored here (getting started, architecture, guides)                                         |
| Packages           | every `packages/*/README.md`, ingested by `src/loaders/docs-with-readmes.ts` (links rewritten for the site)           |
| UI blocks overview | `registry/README.md`, ingested the same way, at `/blocks/`                                                            |
| Block demos        | `src/demos/*` — React islands rendering the registry's own block sources against a mocked server                      |
| Matrices           | `CLAUDE.md`'s dependency matrix and adapter capability table, rendered by `src/components/RepoTable.astro`            |
| API reference      | TypeDoc over each package's `src/index.ts` (starlight-typedoc), regenerated into `src/content/docs/api/` (gitignored) |
| `/llms.txt`        | starlight-llms-txt, from all of the above                                                                             |
| `/r/*`             | the shadcn registry built by `nx run ui-registry:build-registry`, copied in after the build                           |

Editing a package README changes its page on the next build. A broken internal link — in a guide or in any README
— fails the build (starlight-links-validator), and CI builds the site on every push and PR.

**Docs track the latest release.** The site deploys from the commit a release is cut from (see below), so what it
describes is what's on npm.

## Deploying

`.github/workflows/website.yml` builds the site and deploys it with `actions/deploy-pages` when a non-prerelease
GitHub release is published, or on manual dispatch (for docs-only fixes between releases). `public/CNAME` carries
the custom domain.

One-time setup, in the GitHub repository and at the DNS provider:

1. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
2. **Settings → Pages → Custom domain: `mantlejs.com`**, then enable **Enforce HTTPS** once the certificate is issued.
3. DNS for `mantlejs.com`: apex `A` records to GitHub Pages (`185.199.108.153`, `185.199.109.153`,
   `185.199.110.153`, `185.199.111.153`; `AAAA` `2606:50c0:8000::153` … `8003::153` for IPv6), and a `www` `CNAME`
   to `mantlejs.github.io`. Verify the domain for the organization (Settings → Pages → verified domains) to
   prevent takeover.

## Notes

- `cookie@^2` is a direct dependency on purpose: the monorepo hoists Express's `cookie@0.7` to the root, and
  Astro's prerender bundle — which runs from `website/dist` — would otherwise resolve that one and fail.
- The demo theme tokens in `src/styles/global.css` are shadcn's aria-nova values (the same ones as
  `registry/src/styles.css`), switched by Starlight's light/dark toggle.
