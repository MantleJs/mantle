#!/usr/bin/env node
import { newProject } from "@mantlejs/cli";
import type { Auth, Database, PackageManager } from "@mantlejs/cli";

const args = process.argv.slice(2);
const projectName = args.find((arg) => !arg.startsWith("--"));

if (!projectName) {
  console.error(
    "Usage: npm create mantle <project-name> [-- --database <db> --auth <auth> --package-manager <pm> --cors --redis --skip-install]",
  );
  process.exit(1);
}

function flagValue(name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
}

function hasFlag(name: string): boolean {
  return args.includes(`--${name}`);
}

await newProject(projectName, {
  database: flagValue("database") as Database | undefined,
  auth: flagValue("auth") as Auth | undefined,
  cors: hasFlag("cors") ? true : undefined,
  redis: hasFlag("redis") ? true : undefined,
  packageManager: flagValue("package-manager") as PackageManager | undefined,
  skipInstall: hasFlag("skip-install"),
});
