import { generateService } from "./generators/service.js";
import { generateHook } from "./generators/hook.js";
import { generateRepository } from "./generators/repository.js";

export type GeneratorName = "service" | "hook" | "repository";

const GENERATOR_ALIASES: Record<string, GeneratorName> = {
  s: "service",
  h: "hook",
  r: "repository",
};

export interface GenerateOptions {
  directory?: string;
  cwd?: string;
}

export async function generateCommand(generator: string, name: string, options: GenerateOptions): Promise<void> {
  const resolved = (GENERATOR_ALIASES[generator] ?? generator) as GeneratorName;

  switch (resolved) {
    case "service":
      await generateService(name, options);
      break;
    case "hook":
      await generateHook(name, options);
      break;
    case "repository":
      await generateRepository(name, options);
      break;
    default:
      console.error(`Unknown generator: ${generator}. Available: service, hook, repository`);
      process.exit(1);
  }
}
