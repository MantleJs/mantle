import { describe, it, expect, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { generateAuthentication } from "./authentication.js";

const dirs: string[] = [];

async function withPackageJson(deps: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "mantle-auth-gen-test-"));
  dirs.push(dir);
  await writeFile(join(dir, "package.json"), JSON.stringify({ dependencies: deps }));
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("generateAuthentication", () => {
  it("wires apple, microsoft, and linkedin strategies when detected", async () => {
    const dir = await withPackageJson({
      "@mantlejs/auth": "^0.0.1",
      "@mantlejs/auth-apple": "^0.0.1",
      "@mantlejs/auth-microsoft": "^0.0.1",
      "@mantlejs/auth-linkedin": "^0.0.1",
    });

    await generateAuthentication({ cwd: dir });
    const content = await readFile(join(dir, "src/authentication.ts"), "utf-8");

    expect(content).toContain('import { appleStrategy } from "@mantlejs/auth-apple";');
    expect(content).toContain("appleStrategy({");
    expect(content).toContain('import { microsoftStrategy } from "@mantlejs/auth-microsoft";');
    expect(content).toContain('tenant: process.env.MICROSOFT_TENANT ?? "common"');
    expect(content).toContain('import { linkedinStrategy } from "@mantlejs/auth-linkedin";');
  });

  it("falls back to a helpful comment when no auth packages are installed", async () => {
    const dir = await withPackageJson({});
    await generateAuthentication({ cwd: dir });
    const content = await readFile(join(dir, "src/authentication.ts"), "utf-8");
    expect(content).toContain("No @mantlejs/auth-* packages detected.");
  });
});
