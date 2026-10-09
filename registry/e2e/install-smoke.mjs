#!/usr/bin/env node
/**
 * Registry install smoke test (Phase 7 item 8): for each preset, scaffold a fresh Vite + React +
 * Tailwind v4 app with shadcn's React Aria base → point the `@mantle` namespace at the locally built
 * registry (public/r, served over HTTP) → `shadcn add` every item → `tsc -b && vite build` with a
 * fixture App that renders every block. Proves the published JSON installs and compiles exactly the
 * way a consumer gets it, against the real upstream aria primitives — not just in this repo.
 *
 * Network: the scaffold and the base primitives come from npm and ui.shadcn.com (as `shadcn init`
 * always does for a real user). @mantlejs/client and @mantlejs/react are installed from `npm pack`
 * tarballs of this workspace's build, so unreleased client changes are what the blocks compile against.
 *
 * Env:
 *   MANTLE_UI_PRESETS   comma-separated aria presets to cover (default "nova,vega")
 *   MANTLE_UI_KEEP=1    keep the temp apps for inspection
 */
import { mkdtemp, mkdir, readFile, writeFile, rm, copyFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REGISTRY_ROOT = join(__dirname, "..");
const REPO_ROOT = join(REGISTRY_ROOT, "..");
const PUBLIC_R = join(REGISTRY_ROOT, "public/r");
const SHADCN_BIN = join(REPO_ROOT, "node_modules/.bin/shadcn");
const PRESETS = (process.env.MANTLE_UI_PRESETS ?? "nova,vega")
  .split(",")
  .map((p) => p.trim())
  .filter(Boolean);
const PACKED = ["client", "react"];

function log(step) {
  console.log(`\n[e2e-install] ${step}`);
}

/** Async on purpose: the registry is served from this process, so a blocking spawnSync would deadlock `shadcn add`. */
function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "inherit", "inherit"], ...options });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`Command failed (${code}): ${command} ${args.join(" ")}`)),
    );
  });
}

function capture(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.status !== 0) {
    throw new Error(`Command failed (${result.status}): ${command} ${args.join(" ")}\n${result.stderr}`);
  }
  return result.stdout.trim();
}

/** Serves public/r at /r/* on an ephemeral port — what the website will host in production. */
async function serveRegistry() {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
    const file = join(PUBLIC_R, path.replace(/^\/r\//, ""));
    if (!path.startsWith("/r/") || extname(file) !== ".json" || !existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-type": "application/json" }).end(await readFile(file));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  // `{style}` exactly as consumers are told to register it — so this also proves aria presets
  // resolve the fanned-out copies (scripts/fan-out-styles.mjs).
  return { server, url: `http://127.0.0.1:${server.address().port}/r/{style}/{name}.json` };
}

/**
 * Upstream shadcn bug (checked against shadcn 4.21.4's aria-nova `label.tsx`): an unused
 * `import * as React from "react"` fails `tsc` under the Vite template's own `noUnusedLocals`
 * (TS6133). Strip it only while it's still unused — and say so loudly once upstream fixes it.
 */
async function patchUpstreamLabel(appDir) {
  const labelPath = join(appDir, "src/components/ui/label.tsx");
  if (!existsSync(labelPath)) return;
  const source = await readFile(labelPath, "utf8");
  const importLine = /^import \* as React from "react"\r?\n/m;
  if (importLine.test(source) && !/\bReact\./.test(source.replace(importLine, ""))) {
    await writeFile(labelPath, source.replace(importLine, ""));
    log("workaround: removed the unused React import from upstream aria label.tsx (TS6133)");
  } else {
    log("NOTE: upstream aria label.tsx no longer needs the TS6133 workaround — remove patchUpstreamLabel()");
  }
}

/** `shadcn init` a fresh Vite app under `root` and register the local `@mantle` namespace. */
async function scaffold(root, base, preset, registryUrl) {
  await mkdir(root, { recursive: true });
  const appDir = join(root, "app");
  log(`[${base}-${preset}] shadcn init --template vite --base ${base} --preset ${preset}`);
  await run(
    SHADCN_BIN,
    ["init", "--template", "vite", "--base", base, "--preset", preset, "--name", "app", "--no-monorepo", "--yes"],
    { cwd: root },
  );
  const componentsPath = join(appDir, "components.json");
  const components = JSON.parse(await readFile(componentsPath, "utf8"));
  if (components.style !== `${base}-${preset}`) {
    throw new Error(`expected style ${base}-${preset}, got ${components.style}`);
  }
  components.registries = { ...components.registries, "@mantle": registryUrl };
  await writeFile(componentsPath, JSON.stringify(components, null, 2) + "\n");
  return appDir;
}

async function main() {
  if (!existsSync(join(PUBLIC_R, "registry.json"))) {
    throw new Error("registry/public/r is missing — run `nx run ui-registry:build-registry` first");
  }
  const registry = JSON.parse(await readFile(join(PUBLIC_R, "registry.json"), "utf8"));
  const items = registry.items.map((item) => `@mantle/${item.name}`);
  const tmpRoot = await mkdtemp(join(tmpdir(), "mantle-e2e-install-"));
  const { server, url } = await serveRegistry();
  const timings = [];

  try {
    log(`packing @mantlejs/{${PACKED.join(",")}} from the workspace build`);
    const tarballs = PACKED.map((name) =>
      join(
        tmpRoot,
        capture("npm", ["pack", "--pack-destination", tmpRoot, join(REPO_ROOT, "packages", name)])
          .split("\n")
          .pop(),
      ),
    );

    for (const preset of PRESETS) {
      const started = Date.now();
      const appDir = await scaffold(join(tmpRoot, preset), "aria", preset, url);

      log(`[${preset}] installing workspace @mantlejs packages from tarballs`);
      await run("npm", ["install", "--no-audit", "--no-fund", ...tarballs], { cwd: appDir });

      log(`[${preset}] shadcn add ${items.join(" ")}`);
      await run(SHADCN_BIN, ["add", ...items, "--yes", "--overwrite"], { cwd: appDir });
      // `shadcn add` re-resolves item dependencies from npm; put the workspace builds back.
      await run("npm", ["install", "--no-audit", "--no-fund", ...tarballs], { cwd: appDir });

      const installed = await readdir(join(appDir, "src/components/mantle"));
      log(`[${preset}] installed: ${installed.join(", ")}`);
      await patchUpstreamLabel(appDir);
      await copyFile(join(__dirname, "fixture-app.tsx"), join(appDir, "src/App.tsx"));

      log(`[${preset}] npm run build (tsc -b && vite build)`);
      await run("npm", ["run", "build"], { cwd: appDir });
      timings.push(`${preset}: ${((Date.now() - started) / 1000).toFixed(1)}s`);
    }

    // Enforcement check: a non-aria project must be refused at install time (404 on its
    // `{style}` path), not handed blocks that only fail later in tsc or at runtime.
    const started = Date.now();
    const radixDir = await scaffold(join(tmpRoot, "radix"), "radix", "nova", url);
    log("[radix-nova] shadcn add @mantle/login-form — expecting a refusal");
    const refused = await run(SHADCN_BIN, ["add", "@mantle/login-form", "--yes"], { cwd: radixDir }).then(
      () => false,
      () => true,
    );
    if (!refused || existsSync(join(radixDir, "src/components/mantle"))) {
      throw new Error("a radix-nova project was able to install @mantle blocks — the aria-* style gate is broken");
    }
    timings.push(`radix refusal: ${((Date.now() - started) / 1000).toFixed(1)}s`);

    log(`PASS (${timings.join(", ")})`);
  } finally {
    server.close();
    if (process.env.MANTLE_UI_KEEP) log(`kept ${tmpRoot}`);
    else await rm(tmpRoot, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error("\n[e2e-install] FAIL:", err.message);
  process.exit(1);
});
