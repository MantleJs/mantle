import { join } from "node:path";
import { toPascalCase, toKebabCase, writeGeneratedFile } from "../utils.js";
import { detectDatabaseBackend, type DatabaseBackend } from "../detect-database.js";

export interface RepositoryGeneratorOptions {
  directory?: string;
  cwd?: string;
}

export async function generateRepository(name: string, options: RepositoryGeneratorOptions): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const kebab = toKebabCase(name);
  const pascal = toPascalCase(name);
  const dir = join(cwd, options.directory ?? `src/services/${kebab}`);
  const backend = await detectDatabaseBackend(cwd);

  await writeGeneratedFile(join(dir, `${kebab}.repository.ts`), repositoryTemplate(pascal, kebab, backend));

  console.log(`\n  Repository ${pascal} generated at ${dir}`);
}

export function repositoryTemplate(pascal: string, kebab: string, backend: DatabaseBackend): string {
  if (backend === "mongodb") {
    return `import { MongoRepository } from "@mantlejs/mongodb";
import type { ${pascal} } from "./${kebab}.schema.js";

export class ${pascal}Repository extends MongoRepository<${pascal}> {
  readonly collectionName = "${kebab}s";
}
`;
  }

  if (backend === "memory") {
    return `import { MemoryRepository } from "@mantlejs/memory";
import type { ${pascal} } from "./${kebab}.schema.js";

export class ${pascal}Repository extends MemoryRepository<${pascal}> {}
`;
  }

  return `import { KnexRepository } from "@mantlejs/knex";
import type { ${pascal} } from "./${kebab}.schema.js";

export class ${pascal}Repository extends KnexRepository<${pascal}> {
  readonly tableName = "${kebab}s";
}
`;
}
