# Mantle UI registry

Copy-in React blocks wired to Mantle — auth forms, OAuth buttons, an upload dropzone, a realtime list, a
server-sorted data table, pagination, and a type-ahead search — distributed as a
[shadcn registry](https://ui.shadcn.com/docs/registry) and built on
[React Aria](https://react-spectrum.adobe.com/react-aria/) through shadcn's React Aria base. You `shadcn add` a
block and own its source; nothing here is published to npm.

## Requirements

- A shadcn project on a **React Aria style** (`aria-nova`, `aria-vega`, …): `npx shadcn init --base aria --preset nova`.
  Blocks compose React Aria primitives (`TextField` + the aria `Input`, `LinkButton`, `Table` render props) and
  don't work on the Radix or Base UI styles — see [Why aria-only](#why-aria-only).
- `@mantlejs/client` + `@mantlejs/react` with a `<MantleProvider>` around your app (`@mantlejs/react`'s README).
- Tailwind v4 with the CSS-variable theme `shadcn init` writes. Blocks use only semantic tokens (`bg-primary`,
  `text-muted-foreground`, `border-border`, …), so they follow your theme and preset.

## Install

Register the namespace once in `components.json`. Keep `{style}` in the URL — it's how a non-aria project gets
refused at install time:

```json
{
  "registries": {
    "@mantle": "https://<registry-host>/r/{style}/{name}.json"
  }
}
```

Then add blocks (each pulls in the shadcn primitives and Mantle helpers it needs):

```bash
npx shadcn add @mantle/login-form @mantle/signup-form @mantle/oauth-buttons
npx shadcn add @mantle/upload-dropzone @mantle/realtime-list @mantle/data-table @mantle/search-combobox
```

Files land under `components/mantle/` (and `lib/mantle-errors.ts`), so they never collide with shadcn's own
blocks.

> Until the Mantle website hosts the registry (Phase 7 item 13), serve a local build: `npx nx run
ui-registry:build-registry`, then `npx serve registry/public` and use `http://localhost:3000/r/{style}/{name}.json`.

## Blocks

| Item                | What it does                                                                                       | Built on                                            |
| ------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `auth-provider`     | Session state + `useAuth()`: restores a persisted session, consumes OAuth `#accessToken` redirects | `@mantlejs/react` client                            |
| `login-form`        | Email/password against `@mantlejs/auth-local`; field + form-level server errors                    | RAC `Form`, `TextField`, `FieldError`; aria `Input` |
| `signup-form`       | Creates the user through your users service, then logs in                                          | RAC `Form`, `TextField`; aria `Input`, `Button`     |
| `oauth-buttons`     | "Continue with …" links to the seven `@mantlejs/auth-*` strategies (text-only, no logos bundled)   | aria `LinkButton`                                   |
| `upload-dropzone`   | Drop or pick files → multipart `POST` to a `handleUpload()` service, with progress                 | RAC `DropZone`, `FileTrigger`; aria `Progress`      |
| `realtime-list`     | A `find()` result that applies `created`/`patched`/`removed` events in place — no refetch          | RAC `GridList`                                      |
| `data-table`        | Server-side sort (`$sort`) and paging (`$limit`/`$skip`), `$select` of shown fields                | aria `Table` (RAC `Table`/`Column`)                 |
| `mantle-pagination` | Page links for a `Paginated<T>` envelope, driving `$skip`                                          | aria `pagination`                                   |
| `search-combobox`   | Debounced type-ahead over `find()` with `$ilike`, falling back to `$like`                          | aria `Combobox` (RAC `ComboBox`)                    |
| `mantle-errors`     | `toFormErrors()` — `MantleClientError` → React Aria `validationErrors` + a form-level message      | —                                                   |

## Why aria-only

The `{style}` URL placeholder is filled from the consumer's `components.json`, and the build
([`scripts/fan-out-styles.mjs`](./scripts/fan-out-styles.mjs)) only publishes items under `r/aria-<preset>/`.
Observed on a `radix-nova` project with a plain `{name}` URL: `shadcn add` succeeds, then `tsc` fails with TS2322
in `data-table`, `login-form`, and `mantle-pagination` — and a block that happens to compile (an `Input` inside a
React Aria `TextField`) is silently unwired at runtime. With `{style}`, the same project gets
`The item at …/r/radix-nova/login-form.json was not found` before any file is written. The flat `r/<name>.json`
files are still published for tooling that can't template `{style}`.

## Developing

This project is itself an `aria-nova` shadcn project (`components.json`, `@/` alias), so blocks are written with
the exact imports a consumer gets and type-check/test in place.

```bash
npx nx test ui-registry            # Vitest + Testing Library + axe (jsdom)
npx nx run ui-registry:build-registry   # shadcn registry validate → shadcn build → per-style fan-out
npx nx run ui-registry:e2e-install      # fresh aria-nova + aria-vega apps: shadcn add every block, tsc + vite build;
                                        # a radix-nova app must be refused
```

- Block sources: `src/components/mantle/`, `src/lib/mantle-errors.ts`. Register new items in `registry.json` and add
  them to `e2e/fixture-app.tsx`.
- `src/components/ui/` is **vendored verbatim** from shadcn's aria-nova style (`npx shadcn add …` in a scratch
  aria-nova app, then copied) and excluded from lint/prettier so re-vendoring stays a clean diff. One local
  deviation: `label.tsx` drops upstream's unused `import * as React` (TS6133 under this repo's `noUnusedLocals`;
  the smoke test applies the same workaround to consumer apps and logs when upstream no longer needs it).
- Every block spec covers the happy path, typed `MantleClientError` rendering, keyboard-only operation, and zero
  axe violations (`region` and `color-contrast` off — blocks render without page landmarks, and jsdom can't lay
  out colors).
- May import only `@mantlejs/client` and `@mantlejs/react` among workspace packages (`ui-registry` row of
  `CLAUDE.md`'s dependency matrix, enforced by lint).
