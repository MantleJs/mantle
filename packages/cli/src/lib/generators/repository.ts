import { join } from "node:path";
import { toPascalCase, toKebabCase, writeGeneratedFile } from "../utils.js";

export interface RepositoryGeneratorOptions {
  directory?: string;
  cwd?: string;
}

export async function generateRepository(name: string, options: RepositoryGeneratorOptions): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const kebab = toKebabCase(name);
  const pascal = toPascalCase(name);
  const dir = join(cwd, options.directory ?? `src/services/${kebab}`);

  await writeGeneratedFile(join(dir, `${kebab}.repository.ts`), repositoryTemplate(pascal, kebab));

  console.log(`\n  Repository ${pascal} generated at ${dir}`);
}

function repositoryTemplate(pascal: string, kebab: string): string {
  return `import { KnexRepository } from "@mantlejs/knex";
import type { ${pascal} } from "./${kebab}.schema.js";

export class ${pascal}Repository extends KnexRepository<${pascal}> {
  readonly tableName = "${kebab}s";
}
`;
}
