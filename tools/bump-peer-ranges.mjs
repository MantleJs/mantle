#!/usr/bin/env node
/**
 * Bumps every internal @mantlejs/* peerDependency range that points at a project in the given
 * release group to `^<version>`, workspace-wide (not just within the group — a package in a
 * *different* group can still peer-depend on one being released, e.g. dynamodb -> mantle).
 *
 * Run this immediately before `nx release version <version> --groups=<group>` for a real
 * release — never commit a peer-range bump ahead of the actual version bump it's paired with.
 * Until the target packages are actually versioned, nothing (local workspace or registry) can
 * satisfy a peer range that points past their current version, and `npm install`/`npm ci` break
 * workspace-wide. `nx release version` itself will refuse to proceed (its
 * `preserveMatchingDependencyRanges` guard) until ranges already cover the new version — that
 * guard is deliberate; this script exists to satisfy it correctly instead of by hand.
 *
 * Usage:
 *   node tools/bump-peer-ranges.mjs <group> <version>
 *   node tools/bump-peer-ranges.mjs stable 0.1.0
 *   node tools/bump-peer-ranges.mjs experimental 0.1.0-experimental
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const PACKAGES_DIR = join(REPO_ROOT, "packages");
const NX_JSON = join(REPO_ROOT, "nx.json");

function fail(message) {
  console.error(`bump-peer-ranges: ${message}`);
  process.exit(1);
}

const [, , groupArg, versionArg] = process.argv;
if (!groupArg || !versionArg) {
  fail("usage: node tools/bump-peer-ranges.mjs <group> <version>");
}

const nx = JSON.parse(readFileSync(NX_JSON, "utf8"));
const group = nx.release?.groups?.[groupArg];
if (!group) fail(`no release group "${groupArg}" in nx.json`);

const groupProjects = new Set(group.projects);
const packageNameByProject = new Map();

const dirs = readdirSync(PACKAGES_DIR).filter((d) => existsSync(join(PACKAGES_DIR, d, "package.json")));
for (const dir of dirs) {
  const pkg = JSON.parse(readFileSync(join(PACKAGES_DIR, dir, "package.json"), "utf8"));
  packageNameByProject.set(dir, pkg.name);
}

const releasedPackageNames = new Set([...groupProjects].map((p) => packageNameByProject.get(p)).filter(Boolean));

let changed = 0;
for (const dir of dirs) {
  const file = join(PACKAGES_DIR, dir, "package.json");
  const pkg = JSON.parse(readFileSync(file, "utf8"));
  let touched = false;
  for (const dep of Object.keys(pkg.peerDependencies ?? {})) {
    if (!releasedPackageNames.has(dep)) continue;
    const next = `^${versionArg}`;
    if (pkg.peerDependencies[dep] !== next) {
      pkg.peerDependencies[dep] = next;
      touched = true;
    }
  }
  if (touched) {
    writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n");
    console.log(`updated ${dir}/package.json`);
    changed++;
  }
}

console.log(`bump-peer-ranges: ${changed} package.json file(s) updated for group "${groupArg}" -> ^${versionArg}`);
