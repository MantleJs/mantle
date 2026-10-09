#!/usr/bin/env node
/**
 * Post-`shadcn build` step: copies every built item into `public/r/aria-<preset>/` for each React
 * Aria preset. Consumers register the namespace as `https://<host>/r/{style}/{name}.json`; shadcn
 * fills `{style}` from their components.json, so an `aria-*` project resolves these copies while a
 * Radix or Base UI project (`radix-nova`, `base-nova`, …) gets a 404 *before* anything is written.
 *
 * Why enforce it: the blocks compose React Aria primitives (`TextField` + the aria `Input`,
 * `LinkButton`, `isPending`, `Table` render props). Installed into a Radix project they half-work —
 * the observed result is a successful `shadcn add` followed by TS2322 errors in `tsc`, and, worse,
 * a login form that compiles but whose `Input` isn't wired to its `TextField` (no label association,
 * no validation) at runtime. Failing at install time is the honest outcome.
 *
 * The flat `public/r/<name>.json` files stay for tooling that can't template `{style}`.
 */
import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/** shadcn's preset names as of the pinned CLI (shadcn 4.21.4); update alongside the pin. */
export const ARIA_PRESETS = ["nova", "vega", "maia", "lyra", "mira", "luma", "sera", "rhea"];

const OUT = join(dirname(fileURLToPath(import.meta.url)), "../public/r");

const files = (await readdir(OUT)).filter((name) => name.endsWith(".json"));
for (const preset of ARIA_PRESETS) {
  const dir = join(OUT, `aria-${preset}`);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  for (const file of files) await cp(join(OUT, file), join(dir, file));
}
console.log(`✓ ${files.length} registry files fanned out to ${ARIA_PRESETS.map((p) => `aria-${p}`).join(", ")}`);
