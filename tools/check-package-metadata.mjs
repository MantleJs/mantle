#!/usr/bin/env node
/**
 * Phase 8 item 5 (PRD spec 15) guard, run in CI: every package under packages/ must ship the MIT license
 * text and point its npm homepage at its mantlejs.com page.
 *
 * Checks, per package:
 *   - a package-root LICENSE exists and is identical to the repo-root LICENSE
 *     (npm always packs a package-root LICENSE, regardless of `files` — Decision #1)
 *   - license === "MIT"
 *   - homepage === "https://mantlejs.com/packages/<dir>/"
 *
 * Unlike check-publish-fields.mjs, private packages are checked too: a package flipped to public later
 * should already be compliant.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const PACKAGES_DIR = join(REPO_ROOT, "packages");
const ROOT_LICENSE = readFileSync(join(REPO_ROOT, "LICENSE"), "utf8");

function checkPackage(dir) {
  const errors = [];
  const pkg = JSON.parse(readFileSync(join(PACKAGES_DIR, dir, "package.json"), "utf8"));

  const licensePath = join(PACKAGES_DIR, dir, "LICENSE");
  if (!existsSync(licensePath)) {
    errors.push("LICENSE file is missing");
  } else if (readFileSync(licensePath, "utf8") !== ROOT_LICENSE) {
    errors.push("LICENSE differs from the repo-root LICENSE");
  }

  if (pkg.license !== "MIT") errors.push(`license must be "MIT", got ${JSON.stringify(pkg.license)}`);

  const expectedHomepage = `https://mantlejs.com/packages/${dir}/`;
  if (pkg.homepage !== expectedHomepage) {
    errors.push(`homepage must be "${expectedHomepage}", got ${JSON.stringify(pkg.homepage)}`);
  }

  return errors.map((message) => `${dir}: ${message}`);
}

const dirs = readdirSync(PACKAGES_DIR).filter((name) => existsSync(join(PACKAGES_DIR, name, "package.json")));
const errors = dirs.flatMap(checkPackage);

if (errors.length > 0) {
  console.error(`✗ Package metadata check failed (${errors.length} problem${errors.length === 1 ? "" : "s"}):`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}
console.log(`✓ Package metadata: ${dirs.length} packages ship the MIT LICENSE and point homepage at mantlejs.com.`);
