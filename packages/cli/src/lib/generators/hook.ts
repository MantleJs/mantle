import { join } from "node:path";
import { toPascalCase, toCamelCase, toKebabCase, writeGeneratedFile } from "../utils.js";

export interface HookGeneratorOptions {
  directory?: string;
  cwd?: string;
}

export async function generateHook(name: string, options: HookGeneratorOptions): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const kebab = toKebabCase(name);
  const camel = toCamelCase(name);
  const pascal = toPascalCase(name);
  const dir = join(cwd, options.directory ?? `src/services/${kebab}`);

  await writeGeneratedFile(join(dir, `${kebab}.hook.ts`), hookTemplate(camel, pascal));
  await writeGeneratedFile(join(dir, `${kebab}.hook.spec.ts`), hookSpecTemplate(camel, kebab));

  console.log(`\n  Hook ${pascal} generated at ${dir}`);
}

function hookTemplate(camel: string, pascal: string): string {
  return `import type { HookContext, HookFunction } from "@mantlejs/core";

export interface ${pascal}Options {
  // add options here
}

export function ${camel}(options: ${pascal}Options = {}): HookFunction {
  return async (context: HookContext): Promise<HookContext> => {
    // implement hook logic here
    return context;
  };
}
`;
}

function hookSpecTemplate(camel: string, kebab: string): string {
  return `import { describe, it, expect } from "vitest";
import type { HookContext } from "@mantlejs/core";
import { ${camel} } from "./${kebab}.hook.js";

const makeContext = (overrides: Partial<HookContext> = {}): HookContext =>
  ({
    method: "create",
    path: "test",
    params: {},
    ...overrides,
  }) as HookContext;

describe("${camel}", () => {
  it("returns the context unchanged", async () => {
    const hook = ${camel}();
    const ctx = makeContext();
    const result = await hook(ctx);
    expect(result).toBe(ctx);
  });
});
`;
}
