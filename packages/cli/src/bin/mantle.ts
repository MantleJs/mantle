#!/usr/bin/env node
import { program } from "commander";
import { newProject } from "../lib/new.js";
import { generateCommand } from "../lib/generate.js";
import { addPackage } from "../lib/add.js";

program.name("mantle").description("Mantle JS CLI").version("0.0.1");

program
  .command("new <project-name>")
  .description("Scaffold a new Mantle project")
  .option("--transport <transport>", "HTTP transport (express)", "express")
  .option("--database <db>", "Database adapter (pg, sqlite, none)")
  .option("--auth <auth>", "Auth strategy (local, google, github, none)")
  .option("--package-manager <pm>", "Package manager (npm, yarn, pnpm)")
  .option("--skip-install", "Skip package installation", false)
  .action(async (projectName: string, opts: Record<string, unknown>) => {
    await newProject(projectName, {
      transport: opts.transport as "express" | undefined,
      database: opts.database as "pg" | "sqlite" | "none" | undefined,
      auth: opts.auth as "local" | "google" | "github" | "none" | undefined,
      packageManager: opts.packageManager as "npm" | "yarn" | "pnpm" | undefined,
      skipInstall: opts.skipInstall as boolean | undefined,
    });
  });

program
  .command("add <package>")
  .description("Install a Mantle package and wire it into src/app.ts")
  .action(async (packageName: string) => {
    await addPackage(packageName);
  });

const gen = program.command("generate").alias("g").description("Generate Mantle code");

gen
  .command("service <name>")
  .alias("s")
  .description("Generate a service, repository, schema, and spec")
  .option("--directory <path>", "Output directory (default: src/services/<name>)")
  .action(async (name: string, opts: Record<string, unknown>) => {
    await generateCommand("service", name, { directory: opts.directory as string | undefined });
  });

gen
  .command("hook <name>")
  .alias("h")
  .description("Generate a hook and spec")
  .option("--directory <path>", "Output directory (default: src/services/<name>)")
  .action(async (name: string, opts: Record<string, unknown>) => {
    await generateCommand("hook", name, { directory: opts.directory as string | undefined });
  });

gen
  .command("repository <name>")
  .alias("r")
  .description("Generate a repository")
  .option("--directory <path>", "Output directory (default: src/services/<name>)")
  .action(async (name: string, opts: Record<string, unknown>) => {
    await generateCommand("repository", name, { directory: opts.directory as string | undefined });
  });

gen
  .command("authentication")
  .alias("auth")
  .description("Generate src/authentication.ts with detected auth strategy configuration")
  .action(async () => {
    await generateCommand("authentication", undefined, {});
  });

gen
  .command("migration <name>")
  .alias("m")
  .description("Generate a Knex migration file (requires @mantlejs/knex)")
  .action(async (name: string) => {
    await generateCommand("migration", name, {});
  });

program.parseAsync(process.argv).catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
