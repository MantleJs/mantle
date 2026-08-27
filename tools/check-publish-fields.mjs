#!/usr/bin/env node
/**
 * Phase 5 item 9 pre-flight check: every publishable package.json under packages/ must carry
 * the fields `nx release publish` and npm's registry actually require. Run before every publish
 * rehearsal — a package failing this check will either fail to publish or publish broken.
 *
 * Checks, per package:
 *   - publishConfig.access === "public"        (scoped packages default to private otherwise)
 *   - files includes "dist"                     (nothing outside dist ships)
 *   - main/module/types (or exports["."]) all resolve into dist/
 *   - license is set
 *   - repository is set
 *   - homepage is set
 *   - every @mantlejs/* peerDependency range is identical across all packages that declare it
 *
 * Packages with "private": true are skipped.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const PACKAGES_DIR = join(REPO_ROOT, "packages");

function loadPackages() {
  const dirs = readdirSync(PACKAGES_DIR).filter((name) => existsSync(join(PACKAGES_DIR, name, "package.json")));
  return dirs.map((dir) => {
    const path = join(PACKAGES_DIR, dir, "package.json");
    return { dir, path, pkg: JSON.parse(readFileSync(path, "utf8")) };
  });
}

function resolvesIntoDist(value) {
  return typeof value === "string" && value.replace(/^\.\//, "").startsWith("dist/");
}

function checkPackage({ dir, pkg }) {
  const errors = [];

  if (!pkg.publishConfig || pkg.publishConfig.access !== "public") {
    errors.push('publishConfig.access must be "public"');
  }

  if (!Array.isArray(pkg.files) || !pkg.files.includes("dist")) {
    errors.push('files must include "dist"');
  }

  const exportsRoot = pkg.exports?.["."];
  const mainOk = resolvesIntoDist(pkg.main) || resolvesIntoDist(exportsRoot?.default) || resolvesIntoDist(exportsRoot?.import);
  const typesOk = resolvesIntoDist(pkg.types) || resolvesIntoDist(exportsRoot?.types);
  if (!mainOk) errors.push("main (or exports['.'].default/.import) must resolve into dist/");
  if (!typesOk) errors.push("types (or exports['.'].types) must resolve into dist/");
  if (pkg.module !== undefined && !resolvesIntoDist(pkg.module)) {
    errors.push("module, when set, must resolve into dist/");
  }

  if (!pkg.license) errors.push("license is missing");
  if (!pkg.repository) errors.push("repository is missing");
  if (!pkg.homepage) errors.push("homepage is missing");

  return errors.map((message) => `${dir}: ${message}`);
}

function checkAlignedPeerRanges(packages) {
  /** @type {Map<string, Map<string, string[]>>} dep name -> range -> [package dirs using it] */
  const byDep = new Map();
  for (const { dir, pkg } of packages) {
    for (const [dep, range] of Object.entries(pkg.peerDependencies ?? {})) {
      if (!dep.startsWith("@mantlejs/")) continue;
      const ranges = byDep.get(dep) ?? new Map();
      const users = ranges.get(range) ?? [];
      users.push(dir);
      ranges.set(range, users);
      byDep.set(dep, ranges);
    }
  }

  const errors = [];
  for (const [dep, ranges] of byDep) {
    if (ranges.size <= 1) continue;
    const breakdown = [...ranges.entries()].map(([range, users]) => `${range} (${users.join(", ")})`).join(" vs. ");
    errors.push(`peerDependency ranges for ${dep} are not aligned across the workspace: ${breakdown}`);
  }
  return errors;
}

function main() {
  const packages = loadPackages().filter(({ pkg }) => pkg.private !== true);
  const errors = packages.flatMap(checkPackage);
  errors.push(...checkAlignedPeerRanges(packages));

  if (errors.length === 0) {
    console.log(`check-publish-fields: ${packages.length} packages OK`);
    return;
  }

  console.error(`check-publish-fields: ${errors.length} problem(s) across ${packages.length} packages\n`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exitCode = 1;
}

main();
