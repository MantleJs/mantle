import { describe, it, expect, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { newProject } from "./new.js";

const dirs: string[] = [];

async function scaffold(options: Parameters<typeof newProject>[1]): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "mantle-new-test-"));
  dirs.push(cwd);
  await newProject("app", { ...options, cwd, skipInstall: true });
  return join(cwd, "app");
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("newProject", () => {
  it("scaffolds a minimal app with no database and no auth", async () => {
    const dir = await scaffold({ database: "none", auth: "none", packageManager: "npm" });
    const appTs = await readFile(join(dir, "src/app.ts"), "utf-8");
    const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf-8"));

    expect(appTs).toContain('import { express } from "@mantlejs/express";');
    expect(appTs).not.toContain("knex");
    expect(appTs).not.toContain("auth");
    expect(pkg.dependencies).toHaveProperty("@mantlejs/mantle");
    expect(pkg.dependencies).toHaveProperty("@mantlejs/schema");
    expect(pkg.dependencies).not.toHaveProperty("@mantlejs/knex");
  });

  it("wires mongodb as a database choice", async () => {
    const dir = await scaffold({ database: "mongodb", auth: "none", packageManager: "npm" });
    const appTs = await readFile(join(dir, "src/app.ts"), "utf-8");
    const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf-8"));
    const env = await readFile(join(dir, ".env.example"), "utf-8");

    expect(appTs).toContain('import { mongodb } from "@mantlejs/mongodb";');
    expect(appTs.replace(/\s+/g, " ")).toContain(".configure( mongodb(");
    expect(pkg.dependencies).toHaveProperty("@mantlejs/mongodb");
    expect(pkg.dependencies).toHaveProperty("mongodb");
    expect(env).toContain("MONGODB_URI=");
  });

  it("uses a knex-compatible sqlite client matching the installed driver", async () => {
    const dir = await scaffold({ database: "sqlite", auth: "none", packageManager: "npm" });
    const appTs = await readFile(join(dir, "src/app.ts"), "utf-8");
    const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf-8"));

    expect(appTs).toContain('client: "better-sqlite3"');
    expect(pkg.dependencies).toHaveProperty("better-sqlite3");
  });

  it("enables CORS on the express transport when requested", async () => {
    const dir = await scaffold({ database: "none", auth: "none", packageManager: "npm", cors: true });
    const appTs = await readFile(join(dir, "src/app.ts"), "utf-8");
    expect(appTs).toContain(".configure(express(undefined, { cors: true }))");
  });

  it("omits CORS by default", async () => {
    const dir = await scaffold({ database: "none", auth: "none", packageManager: "npm" });
    const appTs = await readFile(join(dir, "src/app.ts"), "utf-8");
    expect(appTs).toContain(".configure(express())");
  });

  for (const auth of ["facebook", "apple", "microsoft", "linkedin"] as const) {
    it(`wires the ${auth} auth strategy`, async () => {
      const dir = await scaffold({ database: "none", auth, packageManager: "npm" });
      const appTs = await readFile(join(dir, "src/app.ts"), "utf-8");
      const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf-8"));

      expect(appTs).toContain(`@mantlejs/auth-${auth}`);
      expect(pkg.dependencies).toHaveProperty(`@mantlejs/auth-${auth}`);
    });
  }

  it("gives apple its teamId/keyId/privateKey fields instead of a client secret", async () => {
    const dir = await scaffold({ database: "none", auth: "apple", packageManager: "npm" });
    const appTs = await readFile(join(dir, "src/app.ts"), "utf-8");
    const env = await readFile(join(dir, ".env.example"), "utf-8");

    expect(appTs).toContain("teamId: process.env.APPLE_TEAM_ID!");
    expect(appTs).toContain("keyId: process.env.APPLE_KEY_ID!");
    expect(appTs).not.toContain("APPLE_CLIENT_SECRET");
    expect(env).toContain("APPLE_TEAM_ID=");
  });

  it("wires redis-backed OAuth state and refresh-token stores when requested", async () => {
    const dir = await scaffold({ database: "none", auth: "google", packageManager: "npm", redis: true });
    const appTs = await readFile(join(dir, "src/app.ts"), "utf-8");
    const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf-8"));
    const env = await readFile(join(dir, ".env.example"), "utf-8");

    expect(appTs).toContain('import { Redis } from "ioredis";');
    expect(appTs).toContain("refreshTokenStore: redisRefreshTokenStore(redisClient)");
    expect(appTs).toContain("stateStore: redisStateStore(redisClient)");
    expect(pkg.dependencies).toHaveProperty("@mantlejs/auth-redis");
    expect(pkg.dependencies).toHaveProperty("ioredis");
    expect(env).toContain("REDIS_URL=");
  });

  it("ignores redis when auth is none", async () => {
    const dir = await scaffold({ database: "none", auth: "none", packageManager: "npm", redis: true });
    const appTs = await readFile(join(dir, "src/app.ts"), "utf-8");
    const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf-8"));

    expect(appTs).not.toContain("ioredis");
    expect(pkg.dependencies).not.toHaveProperty("@mantlejs/auth-redis");
  });

  it("generates a graceful-shutdown index.ts that exits cleanly on SIGTERM", async () => {
    const dir = await scaffold({ database: "none", auth: "none", packageManager: "npm" });
    const indexTs = await readFile(join(dir, "src/index.ts"), "utf-8");

    expect(indexTs).toContain('process.on("SIGTERM"');
    expect(indexTs).toContain("await app.teardown();");
    expect(indexTs).toContain("process.exit(0);");
  });

  it("adds @node-rs/argon2 as a dependency for the local auth strategy", async () => {
    const dir = await scaffold({ database: "none", auth: "local", packageManager: "npm" });
    const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf-8"));
    expect(pkg.dependencies).toHaveProperty("@node-rs/argon2");
  });
});
