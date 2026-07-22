import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { fileExists } from "./utils.js";

export type DatabaseBackend = "knex" | "mongodb" | "memory";

/**
 * Inspects the target project's `package.json` to pick which `Repository<T>` base class
 * generated code should extend — mirrors the database choice made by `mantle new`.
 * Falls back to `@mantlejs/memory` when neither adapter is installed (the `--database none`
 * scaffold), so generated repositories always compile without a database configured.
 */
export async function detectDatabaseBackend(cwd: string): Promise<DatabaseBackend> {
  const pkgPath = join(cwd, "package.json");
  if (!(await fileExists(pkgPath))) return "memory";

  const raw = await readFile(pkgPath, "utf-8");
  const pkg = JSON.parse(raw) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };

  if ("@mantlejs/mongodb" in deps) return "mongodb";
  if ("@mantlejs/knex" in deps) return "knex";
  return "memory";
}
