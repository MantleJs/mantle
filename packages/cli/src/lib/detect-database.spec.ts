import { describe, it, expect, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { detectDatabaseBackend } from "./detect-database.js";

const dirs: string[] = [];

async function withPackageJson(deps: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "mantle-detect-db-test-"));
  dirs.push(dir);
  await writeFile(join(dir, "package.json"), JSON.stringify({ dependencies: deps }));
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("detectDatabaseBackend", () => {
  it("returns memory when no package.json exists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mantle-detect-db-test-"));
    dirs.push(dir);
    expect(await detectDatabaseBackend(dir)).toBe("memory");
  });

  it("returns memory when neither knex nor mongodb is installed", async () => {
    const dir = await withPackageJson({ "@mantlejs/mantle": "^0.0.1" });
    expect(await detectDatabaseBackend(dir)).toBe("memory");
  });

  it("returns knex when @mantlejs/knex is installed", async () => {
    const dir = await withPackageJson({ "@mantlejs/knex": "^0.0.1" });
    expect(await detectDatabaseBackend(dir)).toBe("knex");
  });

  it("returns mongodb when @mantlejs/mongodb is installed", async () => {
    const dir = await withPackageJson({ "@mantlejs/mongodb": "^0.0.1" });
    expect(await detectDatabaseBackend(dir)).toBe("mongodb");
  });

  it("prefers mongodb when both are somehow present", async () => {
    const dir = await withPackageJson({ "@mantlejs/knex": "^0.0.1", "@mantlejs/mongodb": "^0.0.1" });
    expect(await detectDatabaseBackend(dir)).toBe("mongodb");
  });
});
