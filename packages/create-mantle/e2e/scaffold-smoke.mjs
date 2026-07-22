#!/usr/bin/env node
/**
 * e2e-scaffold smoke test (TDD §8): non-interactive `create-mantle` → install with workspace
 * packages linked → build + test inside the scaffold → boot on an ephemeral port → CRUD
 * round-trip against the generated (memory-backed) service → SIGTERM → assert clean exit.
 *
 * Set MANTLE_REGISTRY to re-run the same flow against a real npm registry (post-release gate) —
 * dependencies are installed by version instead of `file:` links to the workspace.
 */
import { mkdtemp, readFile, writeFile, rm, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "../../..");
const CREATE_MANTLE_BIN = join(REPO_ROOT, "packages/create-mantle/dist/bin/create-mantle.js");
const MANTLE_BIN = join(REPO_ROOT, "packages/cli/dist/bin/mantle.js");

const WORKSPACE_LINKS = {
  "@mantlejs/mantle": "mantle",
  "@mantlejs/express": "express",
  "@mantlejs/schema": "schema",
  "@mantlejs/memory": "memory",
};

function log(step) {
  console.log(`\n[e2e-scaffold] ${step}`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.status !== 0) {
    throw new Error(`Command failed (${result.status}): ${command} ${args.join(" ")}`);
  }
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function httpJson(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => undefined) };
}

async function waitForServer(url, timeoutMs = 15_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Server at ${url} did not become ready within ${timeoutMs}ms`);
}

async function linkWorkspacePackages(appDir) {
  const pkgPath = join(appDir, "package.json");
  const pkg = JSON.parse(await readFile(pkgPath, "utf-8"));
  for (const [name, dir] of Object.entries(WORKSPACE_LINKS)) {
    const target = `file:${join(REPO_ROOT, "packages", dir)}`;
    if (pkg.dependencies?.[name]) pkg.dependencies[name] = target;
    if (pkg.devDependencies?.[name]) pkg.devDependencies[name] = target;
  }
  await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
}

async function wireItemsService(appDir) {
  const appFile = join(appDir, "src/app.ts");
  await appendFile(
    appFile,
    `\nimport { ItemsService } from "./services/items/items.service.js";\n` +
      `import { ItemsRepository } from "./services/items/items.repository.js";\n\n` +
      `app.use("items", new ItemsService(new ItemsRepository()), { methods: ["find", "get", "create"] });\n`,
  );
}

async function main() {
  const registry = process.env.MANTLE_REGISTRY;
  const tmpRoot = await mkdtemp(join(tmpdir(), "mantle-e2e-scaffold-"));
  const appDir = join(tmpRoot, "smoke-app");

  try {
    log("scaffolding via create-mantle (non-interactive, memory adapter)");
    run("node", [
      CREATE_MANTLE_BIN,
      "smoke-app",
      "--database",
      "none",
      "--auth",
      "none",
      "--package-manager",
      "npm",
      "--skip-install",
    ], { cwd: tmpRoot });

    log("generating a service (mantle generate service items)");
    run("node", [MANTLE_BIN, "generate", "service", "items"], { cwd: appDir });

    log("wiring the generated service into src/app.ts");
    await wireItemsService(appDir);

    if (!registry) {
      log("linking workspace packages via file:");
      await linkWorkspacePackages(appDir);
    } else {
      log(`installing from registry: ${registry}`);
    }

    log("npm install");
    run("npm", ["install", ...(registry ? ["--registry", registry] : [])], { cwd: appDir });

    log("npm run build");
    run("npm", ["run", "build"], { cwd: appDir });

    log("npm test");
    run("npm", ["test"], { cwd: appDir });

    const port = await getFreePort();
    log(`booting on ephemeral port ${port}`);
    const child = spawn("node", ["dist/index.js"], {
      cwd: appDir,
      env: { ...process.env, PORT: String(port) },
      stdio: "inherit",
    });

    const baseUrl = `http://localhost:${port}`;
    let exit;
    try {
      await waitForServer(`${baseUrl}/items`);

      log("POST /items");
      const created = await httpJson("POST", `${baseUrl}/items`, { name: "smoke-test" });
      if (created.status !== 201) {
        throw new Error(`Expected 201 from POST /items, got ${created.status}`);
      }

      log("GET /items");
      const listed = await httpJson("GET", `${baseUrl}/items`);
      if (listed.status !== 200) {
        throw new Error(`Expected 200 from GET /items, got ${listed.status}`);
      }
      if (!Array.isArray(listed.body) || listed.body.length !== 1) {
        throw new Error(`Expected exactly one item, got ${JSON.stringify(listed.body)}`);
      }
    } finally {
      log("sending SIGTERM");
      exit = await new Promise((resolve) => {
        const timeout = setTimeout(() => resolve({ code: null, signal: "TIMEOUT" }), 10_000);
        child.on("exit", (code, signal) => {
          clearTimeout(timeout);
          resolve({ code, signal });
        });
        child.kill("SIGTERM");
      });
    }

    if (exit.signal === "TIMEOUT") {
      throw new Error("Scaffolded app did not exit within 10s of SIGTERM");
    }
    if (exit.code !== 0) {
      throw new Error(`Expected clean exit (code 0) after SIGTERM, got code=${exit.code} signal=${exit.signal}`);
    }
    log(`clean exit after SIGTERM (code=${exit.code})`);

    log("PASS");
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error("\n[e2e-scaffold] FAIL:", err.message);
  process.exit(1);
});
