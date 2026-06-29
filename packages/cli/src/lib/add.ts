import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileExists } from "./utils.js";
import { PACKAGE_WIRINGS, type ImportEntry } from "./wiring.js";
import { modifyAppFile } from "./app-modifier.js";

export interface AddOptions {
  cwd?: string;
}

async function detectPackageManager(cwd: string): Promise<"npm" | "yarn" | "pnpm"> {
  if (await fileExists(join(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (await fileExists(join(cwd, "yarn.lock"))) return "yarn";
  return "npm";
}

function installPackage(pm: string, packageName: string, cwd: string): boolean {
  const args = pm === "npm" ? ["install", packageName] : ["add", packageName];
  const result = spawnSync(pm, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
  return result.status === 0;
}

function formatImportLine(entry: ImportEntry): string {
  const specifiers: string[] = [];
  if (entry.defaultImport) specifiers.push(entry.defaultImport);
  if (entry.names?.length) specifiers.push(`{ ${entry.names.join(", ")} }`);
  return `  import ${specifiers.join(", ")} from "${entry.path}";`;
}

export async function addPackage(packageName: string, options: AddOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const pm = await detectPackageManager(cwd);

  console.log(`\nInstalling ${packageName} with ${pm}...`);

  if (!installPackage(pm, packageName, cwd)) {
    console.error(`\nInstall failed.`);
    process.exit(1);
  }

  const wiring = PACKAGE_WIRINGS[packageName];
  if (!wiring) {
    console.log(`\n  ${packageName} installed.`);
    console.log(`\n  No automatic wiring available for this package.`);
    console.log(`  Add it manually to src/app.ts:`);
    console.log(`\n    import { <plugin> } from "${packageName}";`);
    console.log(`    .configure(<plugin>())\n`);
    return;
  }

  const appFilePath = join(cwd, "src/app.ts");
  const modified = await modifyAppFile(appFilePath, wiring);

  if (modified) {
    console.log(`\n  Updated src/app.ts`);
  } else {
    console.log(`\n  Could not automatically update src/app.ts.`);
    console.log(`  Add manually:\n`);
    for (const entry of wiring.imports) {
      console.log(formatImportLine(entry));
    }
    console.log(`  .configure(${wiring.configureCall})\n`);
  }

  if (wiring.envVars?.length) {
    console.log(`\n  Add to .env:`);
    for (const envVar of wiring.envVars) {
      console.log(`    ${envVar}`);
    }
    console.log();
  }
}
