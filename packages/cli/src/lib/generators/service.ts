import { join } from "node:path";
import { toPascalCase, toKebabCase, writeGeneratedFile } from "../utils.js";

export interface ServiceGeneratorOptions {
  directory?: string;
  cwd?: string;
}

export async function generateService(name: string, options: ServiceGeneratorOptions): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const kebab = toKebabCase(name);
  const pascal = toPascalCase(name);
  const dir = join(cwd, options.directory ?? `src/services/${kebab}`);

  await writeGeneratedFile(join(dir, `${kebab}.service.ts`), serviceTemplate(pascal, kebab));
  await writeGeneratedFile(join(dir, `${kebab}.repository.ts`), repositoryTemplate(pascal, kebab));
  await writeGeneratedFile(join(dir, `${kebab}.schema.ts`), schemaTemplate(pascal));
  await writeGeneratedFile(join(dir, `${kebab}.service.spec.ts`), serviceSpecTemplate(pascal, kebab));

  console.log(`\n  Service ${pascal} generated at ${dir}`);
}

function serviceTemplate(pascal: string, kebab: string): string {
  return `import type { Service, ServiceParams, Id, Repository } from "@mantlejs/mantle";
import { NotFound } from "@mantlejs/mantle";
import type { ${pascal} } from "./${kebab}.schema.js";

export class ${pascal}Service implements Service<${pascal}> {
  constructor(private readonly repository: Repository<${pascal}>) {}

  async find(params?: ServiceParams): Promise<${pascal}[]> {
    return this.repository.findAll(params?.query);
  }

  async get(id: Id, _params?: ServiceParams): Promise<${pascal}> {
    const record = await this.repository.findById(id);
    if (!record) throw new NotFound("${pascal} not found");
    return record;
  }

  async create(data: Partial<${pascal}>, _params?: ServiceParams): Promise<${pascal}> {
    return this.repository.save(data);
  }

  async update(id: Id, data: Partial<${pascal}>, _params?: ServiceParams): Promise<${pascal}> {
    return this.repository.updateById(id, data);
  }

  async patch(id: Id, data: Partial<${pascal}>, _params?: ServiceParams): Promise<${pascal}> {
    return this.repository.patchById(id, data);
  }

  async remove(id: Id, _params?: ServiceParams): Promise<${pascal}> {
    return this.repository.deleteById(id);
  }
}
`;
}

function repositoryTemplate(pascal: string, kebab: string): string {
  return `import { KnexRepository } from "@mantlejs/knex";
import type { ${pascal} } from "./${kebab}.schema.js";

export class ${pascal}Repository extends KnexRepository<${pascal}> {
  readonly tableName = "${kebab}s";
}
`;
}

function schemaTemplate(pascal: string): string {
  return `import { Type, type Static } from "@mantlejs/schema";

export const ${pascal}Schema = Type.Object({
  id:        Type.String({ format: "uuid" }),
  createdAt: Type.String({ format: "date-time" }),
  updatedAt: Type.String({ format: "date-time" }),
});

export type ${pascal} = Static<typeof ${pascal}Schema>;
`;
}

function serviceSpecTemplate(pascal: string, kebab: string): string {
  return `import { describe, it, expect, beforeEach } from "vitest";
import { MemoryRepository } from "@mantlejs/memory";
import { ${pascal}Service } from "./${kebab}.service.js";
import type { ${pascal} } from "./${kebab}.schema.js";

describe("${pascal}Service", () => {
  let repo: MemoryRepository<${pascal}>;
  let service: ${pascal}Service;

  beforeEach(() => {
    repo = new MemoryRepository<${pascal}>();
    service = new ${pascal}Service(repo);
  });

  it("creates a record", async () => {
    const record = await service.create({}, {});
    expect(record.id).toBeDefined();
  });

  it("finds records", async () => {
    await service.create({}, {});
    const results = await service.find({});
    expect(results).toHaveLength(1);
  });
});
`;
}
