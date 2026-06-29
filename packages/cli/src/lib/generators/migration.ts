import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { writeGeneratedFile, fileExists } from "../utils.js";

export interface MigrationGeneratorOptions {
  cwd?: string;
}

async function requiresKnex(cwd: string): Promise<boolean> {
  const pkgPath = join(cwd, "package.json");
  if (!(await fileExists(pkgPath))) return false;
  const raw = await readFile(pkgPath, "utf-8");
  const pkg = JSON.parse(raw) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  return "@mantlejs/knex" in deps;
}

function migrationTimestamp(): string {
  const now = new Date();
  const pad = (n: number, len = 2): string => String(n).padStart(len, "0");
  return (
    String(now.getFullYear()) +
    pad(now.getMonth() + 1) +
    pad(now.getDate()) +
    pad(now.getHours()) +
    pad(now.getMinutes()) +
    pad(now.getSeconds())
  );
}

export async function generateMigration(name: string, options: MigrationGeneratorOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();

  if (!(await requiresKnex(cwd))) {
    console.error("\n  @mantlejs/knex is required for migrations. Install it first:");
    console.error("    npm install @mantlejs/knex knex\n");
    process.exit(1);
  }

  const safeName = name.replace(/[\s-]+/g, "_").toLowerCase();
  const fileName = `${migrationTimestamp()}_${safeName}.ts`;
  const outPath = join(cwd, "migrations", fileName);

  await writeGeneratedFile(outPath, migrationTemplate(name));
  console.log();
}

function migrationTemplate(name: string): string {
  return `import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // TODO: implement ${name}
}

export async function down(knex: Knex): Promise<void> {
  // TODO: reverse ${name}
}
`;
}
