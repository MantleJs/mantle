import { generateService } from "./generators/service.js";
import { generateHook } from "./generators/hook.js";
import { generateRepository } from "./generators/repository.js";
import { generateAuthentication } from "./generators/authentication.js";
import { generateMigration } from "./generators/migration.js";

export type GeneratorName = "service" | "hook" | "repository" | "authentication" | "migration";

const GENERATOR_ALIASES: Record<string, GeneratorName> = {
  s: "service",
  h: "hook",
  r: "repository",
  auth: "authentication",
  m: "migration",
};

export interface GenerateOptions {
  directory?: string;
  cwd?: string;
}

export async function generateCommand(
  generator: string,
  name: string | undefined,
  options: GenerateOptions,
): Promise<void> {
  const resolved = (GENERATOR_ALIASES[generator] ?? generator) as GeneratorName;

  switch (resolved) {
    case "service":
      await generateService(name!, options);
      break;
    case "hook":
      await generateHook(name!, options);
      break;
    case "repository":
      await generateRepository(name!, options);
      break;
    case "authentication":
      await generateAuthentication(options);
      break;
    case "migration":
      if (!name) {
        console.error("Migration name is required: mantle generate migration <name>");
        process.exit(1);
      }
      await generateMigration(name, options);
      break;
    default:
      console.error(
        `Unknown generator: ${generator}. Available: service, hook, repository, authentication, migration`,
      );
      process.exit(1);
  }
}
