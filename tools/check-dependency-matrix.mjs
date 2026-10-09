#!/usr/bin/env node
/**
 * Phase 7 item 3a cross-check: CLAUDE.md's "Package Dependency Rules" table is the documented
 * dependency matrix, and the root eslint.config.mjs's @nx/enforce-module-boundaries depConstraints
 * are what's actually enforced. This fails if the two (or the project tags they rely on) drift.
 *
 * Checks:
 *   - every CLAUDE.md row has a dependencyMatrix entry with exactly the same allowed packages, and
 *     vice versa; same for the "test-only:" exceptions vs testOnlyDependencies
 *   - the production and spec-file boundary rules actually configured in eslint.config.mjs's default
 *     export equal the constraints derived from the table (catches hand-edited depConstraints)
 *   - every packages/* project has a row and is tagged exactly ["pkg:<name>", "type:lib"]; the
 *     registry/ project likewise with "type:registry"; every app (examples/*, website/) is tagged ["type:app"]
 *     and has an "anything" row
 *   - every package's @mantlejs/* dependencies/peerDependencies are allowed by its row, and its
 *     @mantlejs/* devDependencies by its row plus its test-only exceptions
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const HEADING = "### Package Dependency Rules";
const BOUNDARY_RULE = "@nx/enforce-module-boundaries";

/** `@mantlejs/foo` → `foo`; `create-mantlejs` → `create-mantlejs`. */
function projectName(pkg) {
  return pkg.replace(/^@mantlejs\//, "");
}

function namesIn(text) {
  return [...text.matchAll(/@mantlejs\/[a-z0-9-]+|\bcreate-mantlejs\b/g)].map((m) => projectName(m[0]));
}

function parseMatrixTable() {
  const md = readFileSync(join(REPO_ROOT, "CLAUDE.md"), "utf8");
  const start = md.indexOf(HEADING);
  if (start < 0) throw new Error(`CLAUDE.md: "${HEADING}" section not found`);
  const lines = md.slice(start).split("\n");
  const first = lines.findIndex((line) => line.startsWith("| Package"));
  const rows = [];
  for (const line of lines.slice(first + 2)) {
    if (!line.startsWith("|")) break;
    const [pkg, deps] = line
      .split("|")
      .slice(1, -1)
      // Prettier escapes markdown metacharacters in table cells (`examples/*` → `examples/\*`).
      .map((cell) => cell.trim().replace(/\\(.)/g, "$1"));
    rows.push({ pkg, deps });
  }

  const matrix = {};
  const testOnly = {};
  const apps = new Set();
  for (const { pkg, deps } of rows) {
    if (APP_ROWS.includes(pkg)) {
      if (/^anything\b/.test(deps)) apps.add(pkg);
      continue;
    }
    const name = projectName(pkg);
    const paren = deps.indexOf("(");
    const main = paren < 0 ? deps : deps.slice(0, paren);
    matrix[name] = /^nothing\b/.test(main.trim()) ? [] : namesIn(main);
    const testOnlyMatch = deps.match(/test-only:([^;)]*)/);
    if (testOnlyMatch) testOnly[name] = namesIn(testOnlyMatch[1]);
  }
  return { matrix, testOnly, apps };
}

const sorted = (list) => [...list].sort();
const same = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));

function compareMaps(label, documented, configured, errors) {
  for (const name of new Set([...Object.keys(documented), ...Object.keys(configured)])) {
    if (!(name in configured)) errors.push(`${label}: "${name}" is in CLAUDE.md but not in eslint.config.mjs`);
    else if (!(name in documented)) errors.push(`${label}: "${name}" is in eslint.config.mjs but not in CLAUDE.md`);
    else if (!same(documented[name], configured[name]))
      errors.push(
        `${label}: "${name}" — CLAUDE.md allows [${sorted(documented[name])}], eslint.config.mjs allows [${sorted(configured[name])}]`,
      );
  }
}

function expectedConstraints(matrix, extras = {}) {
  return [
    ...Object.entries(matrix).map(([name, deps]) => ({
      sourceTag: `pkg:${name}`,
      onlyDependOnLibsWithTags: sorted(new Set([...deps, ...(extras[name] ?? [])])).map((dep) => `pkg:${dep}`),
    })),
    { sourceTag: "type:app", onlyDependOnLibsWithTags: ["*"] },
  ];
}

function normalizeConstraints(constraints) {
  return constraints
    .map((c) => ({ sourceTag: c.sourceTag, onlyDependOnLibsWithTags: sorted(c.onlyDependOnLibsWithTags ?? []) }))
    .sort((a, b) => a.sourceTag.localeCompare(b.sourceTag));
}

function checkConfiguredRules(config, documented, errors) {
  const blocks = config.filter((block) => block.rules?.[BOUNDARY_RULE]);
  const isSpecBlock = (block) => (block.files ?? []).every((glob) => glob.includes(".spec."));
  const production = blocks.filter((block) => !isSpecBlock(block));
  const spec = blocks.filter(isSpecBlock);
  if (production.length !== 1 || spec.length !== 1) {
    errors.push(
      `eslint.config.mjs: expected exactly one production and one spec-file ${BOUNDARY_RULE} block, found ${production.length} and ${spec.length}`,
    );
    return;
  }
  const checks = [
    ["production rule", production[0], expectedConstraints(documented.matrix)],
    ["spec-file rule", spec[0], expectedConstraints(documented.matrix, documented.testOnly)],
  ];
  for (const [label, block, expected] of checks) {
    const configured = block.rules[BOUNDARY_RULE][1]?.depConstraints ?? [];
    if (JSON.stringify(normalizeConstraints(configured)) !== JSON.stringify(normalizeConstraints(expected)))
      errors.push(`eslint.config.mjs ${label}: depConstraints do not match the CLAUDE.md table`);
  }
}

function loadProjects(dir) {
  const root = join(REPO_ROOT, dir);
  return readdirSync(root)
    .filter((name) => existsSync(join(root, name, "package.json")))
    .map((name) => ({
      dir: `${dir}/${name}`,
      pkg: JSON.parse(readFileSync(join(root, name, "package.json"), "utf8")),
    }));
}

/** Unconstrained app rows in CLAUDE.md's table — each must say "anything" and its projects be tagged type:app. */
const APP_ROWS = ["examples/*", "website"];

/** Constrained projects outside packages/*: [directory, expected kind tag]. Same row/tag/dep rules. */
const STANDALONE_PROJECTS = [["registry", "type:registry"]];

function checkConstrainedProject(dir, pkg, kindTag, documented, errors) {
  const name = pkg.nx?.name;
  if (!(name in documented.matrix)) {
    errors.push(`${dir}: project "${name}" has no row in CLAUDE.md's dependency matrix`);
    return;
  }
  if (!same(pkg.nx?.tags ?? [], [`pkg:${name}`, kindTag]))
    errors.push(`${dir}: nx.tags must be ["pkg:${name}", "${kindTag}"], found ${JSON.stringify(pkg.nx?.tags ?? [])}`);

  const allowed = new Set(documented.matrix[name]);
  const allowedInTests = new Set([...allowed, ...(documented.testOnly[name] ?? [])]);
  const internal = (deps) => Object.keys(deps ?? {}).filter((dep) => namesIn(dep).length && dep !== pkg.name);
  for (const dep of [...internal(pkg.dependencies), ...internal(pkg.peerDependencies)]) {
    if (!allowed.has(projectName(dep))) errors.push(`${dir}: depends on ${dep}, which its matrix row does not allow`);
  }
  for (const dep of internal(pkg.devDependencies)) {
    if (!allowedInTests.has(projectName(dep)))
      errors.push(`${dir}: devDepends on ${dep}, which neither its matrix row nor its test-only exceptions allow`);
  }
}

function checkProjects(documented, errors) {
  for (const { dir, pkg } of loadProjects("packages")) {
    checkConstrainedProject(dir, pkg, "type:lib", documented, errors);
  }
  for (const [dir, kindTag] of STANDALONE_PROJECTS) {
    const path = join(REPO_ROOT, dir, "package.json");
    if (!existsSync(path)) {
      errors.push(`${dir}: expected a project here (listed in STANDALONE_PROJECTS)`);
      continue;
    }
    checkConstrainedProject(dir, JSON.parse(readFileSync(path, "utf8")), kindTag, documented, errors);
  }

  const apps = [
    ...loadProjects("examples"),
    ...(existsSync(join(REPO_ROOT, "examples/knowledge-base")) ? loadProjects("examples/knowledge-base") : []),
    ...(existsSync(join(REPO_ROOT, "website/package.json"))
      ? [{ dir: "website", pkg: JSON.parse(readFileSync(join(REPO_ROOT, "website/package.json"), "utf8")) }]
      : []),
  ];
  for (const { dir, pkg } of apps) {
    if (!same(pkg.nx?.tags ?? [], ["type:app"]))
      errors.push(`${dir}: nx.tags must be ["type:app"], found ${JSON.stringify(pkg.nx?.tags ?? [])}`);
  }
}

async function main() {
  const documented = parseMatrixTable();
  const configModule = await import(pathToFileURL(join(REPO_ROOT, "eslint.config.mjs")).href);
  const errors = [];

  for (const row of APP_ROWS) {
    if (!documented.apps.has(row)) errors.push(`CLAUDE.md: the ${row} row must exist and allow "anything"`);
  }
  compareMaps("matrix", documented.matrix, configModule.dependencyMatrix ?? {}, errors);
  compareMaps("test-only", documented.testOnly, configModule.testOnlyDependencies ?? {}, errors);
  checkConfiguredRules(configModule.default, documented, errors);
  checkProjects(documented, errors);

  if (errors.length > 0) {
    console.error(`✗ Dependency matrix check failed (${errors.length}):`);
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }
  const rows = Object.keys(documented.matrix).length;
  console.log(
    `✓ Dependency matrix: ${rows} package rows match eslint.config.mjs, project tags, and package.json deps.`,
  );
}

await main();
