import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import prompts from "prompts";
import { writeGeneratedFile, fileExists } from "./utils.js";

export type Transport = "express";
export type Database = "pg" | "sqlite" | "none";
export type Auth = "local" | "google" | "github" | "none";
export type PackageManager = "npm" | "yarn" | "pnpm";

export interface NewProjectOptions {
  transport?: Transport;
  database?: Database;
  auth?: Auth;
  packageManager?: PackageManager;
  skipInstall?: boolean;
  cwd?: string;
}

export async function newProject(projectName: string, rawOptions: NewProjectOptions): Promise<void> {
  const options = await resolveOptions(rawOptions);
  const targetDir = join(options.cwd ?? process.cwd(), projectName);

  if (await fileExists(targetDir)) {
    console.error(`Error: directory "${projectName}" already exists`);
    process.exit(1);
  }

  console.log(`\nScaffolding ${projectName}...`);
  await mkdir(targetDir, { recursive: true });

  await generateProjectFiles(targetDir, projectName, options);

  console.log(`\n  Project ${projectName} created.`);

  if (!options.skipInstall) {
    console.log(`\n  Installing dependencies with ${options.packageManager}...`);
    const pm = options.packageManager ?? "npm";
    const installCmd = pm === "npm" ? ["npm", "install"] : pm === "yarn" ? ["yarn"] : ["pnpm", "install"];
    const result = spawnSync(installCmd[0], installCmd.slice(1), {
      cwd: targetDir,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    if (result.status !== 0) {
      console.error(`\n  Install failed. Run \`${installCmd.join(" ")}\` manually in ${projectName}/`);
    }
  }

  console.log(`\nDone! Get started:`);
  console.log(`\n  cd ${projectName}`);
  if (options.skipInstall) {
    const pm = options.packageManager ?? "npm";
    console.log(`  ${pm === "yarn" ? "yarn" : pm + " install"}`);
  }
  console.log(`  npm run dev\n`);
}

async function resolveOptions(raw: NewProjectOptions): Promise<Required<NewProjectOptions>> {
  const needsPrompt =
    !raw.transport || !raw.database || !raw.auth || !raw.packageManager;

  if (!needsPrompt) {
    return {
      transport: (raw.transport as Transport) ?? "express",
      database: (raw.database as Database) ?? "pg",
      auth: (raw.auth as Auth) ?? "local",
      packageManager: (raw.packageManager as PackageManager) ?? "npm",
      skipInstall: raw.skipInstall ?? false,
      cwd: raw.cwd ?? process.cwd(),
    };
  }

  const answers = await prompts(
    [
      {
        type: "select",
        name: "database",
        message: "Database",
        choices: [
          { title: "PostgreSQL", value: "pg" },
          { title: "SQLite", value: "sqlite" },
          { title: "None (no database)", value: "none" },
        ],
        initial: 0,
      },
      {
        type: "select",
        name: "auth",
        message: "Authentication",
        choices: [
          { title: "Local (email + password)", value: "local" },
          { title: "Google OAuth", value: "google" },
          { title: "GitHub OAuth", value: "github" },
          { title: "None", value: "none" },
        ],
        initial: 0,
      },
      {
        type: "select",
        name: "packageManager",
        message: "Package manager",
        choices: [
          { title: "npm", value: "npm" },
          { title: "yarn", value: "yarn" },
          { title: "pnpm", value: "pnpm" },
        ],
        initial: 0,
      },
    ],
    {
      onCancel: () => {
        console.log("\nCancelled.");
        process.exit(0);
      },
    },
  );

  return {
    transport: "express",
    database: (raw.database ?? answers.database ?? "pg") as Database,
    auth: (raw.auth ?? answers.auth ?? "local") as Auth,
    packageManager: (raw.packageManager ?? answers.packageManager ?? "npm") as PackageManager,
    skipInstall: raw.skipInstall ?? false,
    cwd: raw.cwd ?? process.cwd(),
  };
}

async function generateProjectFiles(
  dir: string,
  projectName: string,
  options: Required<NewProjectOptions>,
): Promise<void> {
  await writeGeneratedFile(join(dir, "src/app.ts"), appTemplate(options));
  await writeGeneratedFile(join(dir, "src/index.ts"), indexTemplate());
  await writeGeneratedFile(join(dir, "src/services/.gitkeep"), "");
  await writeGeneratedFile(join(dir, "config/default.json"), defaultConfigTemplate());
  await writeGeneratedFile(join(dir, "config/production.json"), productionConfigTemplate());
  await writeGeneratedFile(join(dir, "package.json"), packageJsonTemplate(projectName, options));
  await writeGeneratedFile(join(dir, "tsconfig.json"), tsconfigTemplate());
  await writeGeneratedFile(join(dir, ".env.example"), envExampleTemplate(options));
  await writeGeneratedFile(join(dir, ".gitignore"), gitignoreTemplate());
  await writeGeneratedFile(join(dir, "README.md"), readmeTemplate(projectName));
}

function appTemplate(options: Required<NewProjectOptions>): string {
  const imports: string[] = [`import { mantle } from "@mantlejs/core";`, `import { express } from "@mantlejs/express";`];
  const configures: string[] = [`  .configure(express())`];

  if (options.database === "pg") {
    imports.push(`import { knex } from "@mantlejs/knex";`);
    configures.push(`  .configure(knex({ client: "pg", connection: process.env.DATABASE_URL }))`);
  } else if (options.database === "sqlite") {
    imports.push(`import { knex } from "@mantlejs/knex";`);
    configures.push(`  .configure(knex({ client: "sqlite3", connection: { filename: "./dev.sqlite" }, useNullAsDefault: true }))`);
  }

  if (options.auth === "local") {
    imports.push(`import { auth } from "@mantlejs/auth";`);
    imports.push(`import { localStrategy } from "@mantlejs/auth-local";`);
    configures.push(`  .configure(auth({ secret: process.env.JWT_SECRET! }))`);
    configures.push(`  .configure(localStrategy())`);
  } else if (options.auth === "google") {
    imports.push(`import { auth } from "@mantlejs/auth";`);
    imports.push(`import { googleStrategy } from "@mantlejs/auth-google";`);
    configures.push(`  .configure(auth({ secret: process.env.JWT_SECRET! }))`);
    configures.push(
      `  .configure(googleStrategy({ clientId: process.env.GOOGLE_CLIENT_ID!, clientSecret: process.env.GOOGLE_CLIENT_SECRET! }))`,
    );
  } else if (options.auth === "github") {
    imports.push(`import { auth } from "@mantlejs/auth";`);
    imports.push(`import { githubStrategy } from "@mantlejs/auth-github";`);
    configures.push(`  .configure(auth({ secret: process.env.JWT_SECRET! }))`);
    configures.push(
      `  .configure(githubStrategy({ clientId: process.env.GITHUB_CLIENT_ID!, clientSecret: process.env.GITHUB_CLIENT_SECRET! }))`,
    );
  }

  return `${imports.join("\n")}

export const app = mantle()
${configures.join("\n")};
`;
}

function indexTemplate(): string {
  return `import { app } from "./app.js";

const PORT = Number(process.env.PORT ?? 3030);

app.listen(PORT, () => {
  console.log(\`Mantle app listening on http://localhost:\${PORT}\`);
});
`;
}

function defaultConfigTemplate(): string {
  return JSON.stringify({ port: 3030 }, null, 2) + "\n";
}

function productionConfigTemplate(): string {
  return JSON.stringify({ port: 8080 }, null, 2) + "\n";
}

function packageJsonTemplate(projectName: string, options: Required<NewProjectOptions>): string {
  const deps: Record<string, string> = {
    "@mantlejs/core": "^0.0.1",
    "@mantlejs/express": "^0.0.1",
    express: "^4.18.0",
  };

  if (options.database === "pg") {
    deps["@mantlejs/knex"] = "^0.0.1";
    deps["knex"] = "^3.0.0";
    deps["pg"] = "^8.0.0";
  } else if (options.database === "sqlite") {
    deps["@mantlejs/knex"] = "^0.0.1";
    deps["knex"] = "^3.0.0";
    deps["better-sqlite3"] = "^9.0.0";
  }

  if (options.auth === "local") {
    deps["@mantlejs/auth"] = "^0.0.1";
    deps["@mantlejs/auth-local"] = "^0.0.1";
    deps["jsonwebtoken"] = "^9.0.0";
  } else if (options.auth === "google") {
    deps["@mantlejs/auth"] = "^0.0.1";
    deps["@mantlejs/auth-google"] = "^0.0.1";
    deps["jsonwebtoken"] = "^9.0.0";
  } else if (options.auth === "github") {
    deps["@mantlejs/auth"] = "^0.0.1";
    deps["@mantlejs/auth-github"] = "^0.0.1";
    deps["jsonwebtoken"] = "^9.0.0";
  }

  const pkg = {
    name: projectName,
    version: "0.1.0",
    type: "module",
    scripts: {
      start: "node dist/index.js",
      dev: "tsx watch src/index.ts",
      build: "tsc",
      test: "vitest run",
    },
    dependencies: deps,
    devDependencies: {
      "@mantlejs/memory": "^0.0.1",
      "@types/node": "^22.0.0",
      tsx: "^4.0.0",
      typescript: "^5.0.0",
      vitest: "^2.0.0",
    },
  };

  return JSON.stringify(pkg, null, 2) + "\n";
}

function tsconfigTemplate(): string {
  return JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        module: "Node16",
        moduleResolution: "Node16",
        outDir: "dist",
        strict: true,
        esModuleInterop: true,
        declaration: true,
        skipLibCheck: true,
      },
      include: ["src/**/*.ts"],
      exclude: ["node_modules", "dist", "src/**/*.spec.ts"],
    },
    null,
    2,
  ) + "\n";
}

function envExampleTemplate(options: Required<NewProjectOptions>): string {
  const lines = ["PORT=3030"];

  if (options.database === "pg") {
    lines.push("DATABASE_URL=postgres://user:password@localhost:5432/dbname");
  }

  if (options.auth !== "none") {
    lines.push("JWT_SECRET=change-me");
  }

  if (options.auth === "google") {
    lines.push("GOOGLE_CLIENT_ID=your-google-client-id");
    lines.push("GOOGLE_CLIENT_SECRET=your-google-client-secret");
  } else if (options.auth === "github") {
    lines.push("GITHUB_CLIENT_ID=your-github-client-id");
    lines.push("GITHUB_CLIENT_SECRET=your-github-client-secret");
  }

  return lines.join("\n") + "\n";
}

function gitignoreTemplate(): string {
  return `node_modules/
dist/
.env
*.sqlite
.DS_Store
`;
}

function readmeTemplate(projectName: string): string {
  return `# ${projectName}

A Mantle JS application.

## Getting started

\`\`\`bash
npm install
npm run dev
\`\`\`

## Scripts

| Script | Description |
|--------|-------------|
| \`npm run dev\` | Start development server with hot reload |
| \`npm run build\` | Compile TypeScript to \`dist/\` |
| \`npm start\` | Start production server |
| \`npm test\` | Run tests |
`;
}
