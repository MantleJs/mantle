import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import prompts from "prompts";
import { writeGeneratedFile, fileExists } from "./utils.js";
import { MANTLE_VERSION, THIRD_PARTY_VERSIONS } from "./versions.js";

export type Transport = "express";
export type Database = "pg" | "sqlite" | "mongodb" | "none";
export type Auth = "local" | "google" | "github" | "facebook" | "apple" | "microsoft" | "linkedin" | "none";
export type PackageManager = "npm" | "yarn" | "pnpm";

const OAUTH_AUTH_VALUES = new Set<Auth>(["google", "github", "facebook", "apple", "microsoft", "linkedin"]);

export interface NewProjectOptions {
  transport?: Transport;
  database?: Database;
  auth?: Auth;
  /** Enable CORS on the transport (`@mantlejs/express`'s `cors` option). @default false */
  cors?: boolean;
  /** Wire `@mantlejs/auth-redis` state/refresh-token stores. Ignored when `auth` is `"none"`. @default false */
  redis?: boolean;
  packageManager?: PackageManager;
  skipInstall?: boolean;
  cwd?: string;
}

type ResolvedOptions = Required<Omit<NewProjectOptions, "cors" | "redis">> & { cors: boolean; redis: boolean };

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

async function resolveOptions(raw: NewProjectOptions): Promise<ResolvedOptions> {
  const questions = [];
  if (!raw.database) {
    questions.push({
      type: "select" as const,
      name: "database",
      message: "Database",
      choices: [
        { title: "PostgreSQL", value: "pg" },
        { title: "SQLite", value: "sqlite" },
        { title: "MongoDB", value: "mongodb" },
        { title: "None (no database)", value: "none" },
      ],
      initial: 0,
    });
  }
  if (!raw.auth) {
    questions.push({
      type: "select" as const,
      name: "auth",
      message: "Authentication",
      choices: [
        { title: "Local (email + password)", value: "local" },
        { title: "Google OAuth", value: "google" },
        { title: "GitHub OAuth", value: "github" },
        { title: "Facebook OAuth", value: "facebook" },
        { title: "Sign in with Apple", value: "apple" },
        { title: "Microsoft Entra ID", value: "microsoft" },
        { title: "Sign In with LinkedIn", value: "linkedin" },
        { title: "None", value: "none" },
      ],
      initial: 0,
    });
  }
  if (!raw.packageManager) {
    questions.push({
      type: "select" as const,
      name: "packageManager",
      message: "Package manager",
      choices: [
        { title: "npm", value: "npm" },
        { title: "yarn", value: "yarn" },
        { title: "pnpm", value: "pnpm" },
      ],
      initial: 0,
    });
  }

  const answers = questions.length
    ? await prompts(questions, {
        onCancel: () => {
          console.log("\nCancelled.");
          process.exit(0);
        },
      })
    : {};

  const database = (raw.database ?? answers.database ?? "pg") as Database;
  const auth = (raw.auth ?? answers.auth ?? "local") as Auth;

  return {
    transport: "express",
    database,
    auth,
    cors: raw.cors ?? false,
    redis: auth === "none" ? false : (raw.redis ?? false),
    packageManager: (raw.packageManager ?? answers.packageManager ?? "npm") as PackageManager,
    skipInstall: raw.skipInstall ?? false,
    cwd: raw.cwd ?? process.cwd(),
  };
}

async function generateProjectFiles(dir: string, projectName: string, options: ResolvedOptions): Promise<void> {
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

interface OAuthStrategyTemplate {
  auth: Auth;
  packageName: string;
  importName: string;
  configFields: string[];
  envVars: string[];
}

const OAUTH_STRATEGY_TEMPLATES: Record<string, OAuthStrategyTemplate> = {
  google: {
    auth: "google",
    packageName: "@mantlejs/auth-google",
    importName: "googleStrategy",
    configFields: [
      "clientId: process.env.GOOGLE_CLIENT_ID!",
      "clientSecret: process.env.GOOGLE_CLIENT_SECRET!",
    ],
    envVars: ["GOOGLE_CLIENT_ID=your-google-client-id", "GOOGLE_CLIENT_SECRET=your-google-client-secret"],
  },
  github: {
    auth: "github",
    packageName: "@mantlejs/auth-github",
    importName: "githubStrategy",
    configFields: [
      "clientId: process.env.GITHUB_CLIENT_ID!",
      "clientSecret: process.env.GITHUB_CLIENT_SECRET!",
    ],
    envVars: ["GITHUB_CLIENT_ID=your-github-client-id", "GITHUB_CLIENT_SECRET=your-github-client-secret"],
  },
  facebook: {
    auth: "facebook",
    packageName: "@mantlejs/auth-facebook",
    importName: "facebookStrategy",
    configFields: [
      "clientId: process.env.FACEBOOK_CLIENT_ID!",
      "clientSecret: process.env.FACEBOOK_CLIENT_SECRET!",
    ],
    envVars: ["FACEBOOK_CLIENT_ID=your-facebook-client-id", "FACEBOOK_CLIENT_SECRET=your-facebook-client-secret"],
  },
  apple: {
    auth: "apple",
    packageName: "@mantlejs/auth-apple",
    importName: "appleStrategy",
    configFields: [
      "clientId: process.env.APPLE_CLIENT_ID!",
      "teamId: process.env.APPLE_TEAM_ID!",
      "keyId: process.env.APPLE_KEY_ID!",
      "privateKey: process.env.APPLE_PRIVATE_KEY!",
    ],
    envVars: [
      "APPLE_CLIENT_ID=your-apple-services-id",
      "APPLE_TEAM_ID=your-apple-team-id",
      "APPLE_KEY_ID=your-apple-key-id",
      "APPLE_PRIVATE_KEY=your-apple-p8-private-key",
    ],
  },
  microsoft: {
    auth: "microsoft",
    packageName: "@mantlejs/auth-microsoft",
    importName: "microsoftStrategy",
    configFields: [
      "clientId: process.env.MICROSOFT_CLIENT_ID!",
      "clientSecret: process.env.MICROSOFT_CLIENT_SECRET!",
      'tenant: process.env.MICROSOFT_TENANT ?? "common"',
    ],
    envVars: [
      "MICROSOFT_CLIENT_ID=your-microsoft-client-id",
      "MICROSOFT_CLIENT_SECRET=your-microsoft-client-secret",
      "MICROSOFT_TENANT=common",
    ],
  },
  linkedin: {
    auth: "linkedin",
    packageName: "@mantlejs/auth-linkedin",
    importName: "linkedinStrategy",
    configFields: [
      "clientId: process.env.LINKEDIN_CLIENT_ID!",
      "clientSecret: process.env.LINKEDIN_CLIENT_SECRET!",
    ],
    envVars: ["LINKEDIN_CLIENT_ID=your-linkedin-client-id", "LINKEDIN_CLIENT_SECRET=your-linkedin-client-secret"],
  },
};

function appTemplate(options: ResolvedOptions): string {
  const imports: string[] = [`import { mantle } from "@mantlejs/mantle";`, `import { express } from "@mantlejs/express";`];
  const preamble: string[] = [];
  const configures: string[] = [
    options.cors ? `  .configure(express(undefined, { cors: true }))` : `  .configure(express())`,
  ];

  if (options.database === "pg") {
    imports.push(`import { knex } from "@mantlejs/knex";`);
    configures.push(`  .configure(knex({ client: "pg", connection: process.env.DATABASE_URL }))`);
  } else if (options.database === "sqlite") {
    imports.push(`import { knex } from "@mantlejs/knex";`);
    configures.push(`  .configure(knex({ client: "better-sqlite3", connection: { filename: "./dev.sqlite" } }))`);
  } else if (options.database === "mongodb") {
    imports.push(`import { mongodb } from "@mantlejs/mongodb";`);
    configures.push(
      `  .configure(mongodb({ uri: process.env.MONGODB_URI!, dbName: process.env.MONGODB_DB_NAME ?? "app" }))`,
    );
  }

  if (options.redis) {
    imports.push(`import { Redis } from "ioredis";`);
    imports.push(`import { redisStateStore, redisRefreshTokenStore } from "@mantlejs/auth-redis";`);
    preamble.push(`const redisClient = new Redis(process.env.REDIS_URL!);`);
  }

  if (options.auth !== "none") {
    imports.push(`import { auth } from "@mantlejs/auth";`);
    const authFields = ["secret: process.env.JWT_SECRET!"];
    if (options.redis) authFields.push("refreshTokenStore: redisRefreshTokenStore(redisClient)");
    configures.push(`  .configure(auth({ ${authFields.join(", ")} }))`);

    if (options.auth === "local") {
      imports.push(`import { localStrategy } from "@mantlejs/auth-local";`);
      configures.push(`  .configure(localStrategy())`);
    } else if (OAUTH_AUTH_VALUES.has(options.auth)) {
      const strategy = OAUTH_STRATEGY_TEMPLATES[options.auth];
      imports.push(`import { ${strategy.importName} } from "${strategy.packageName}";`);
      const fields = [...strategy.configFields];
      if (options.redis) fields.push("stateStore: redisStateStore(redisClient)");
      configures.push(`  .configure(${strategy.importName}({ ${fields.join(", ")} }))`);
    }
  }

  const preambleBlock = preamble.length ? `\n${preamble.join("\n")}\n` : "";

  return `${imports.join("\n")}
${preambleBlock}
export const app = mantle()
${configures.join("\n")};
`;
}

function indexTemplate(): string {
  return `import { app } from "./app.js";

const PORT = Number(process.env.PORT ?? 3030);

const server = app.listen(PORT, () => {
  console.log(\`Mantle app listening on http://localhost:\${PORT}\`);
});

async function shutdown(): Promise<void> {
  server.close();
  await app.teardown();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
`;
}

function defaultConfigTemplate(): string {
  return JSON.stringify({ port: 3030 }, null, 2) + "\n";
}

function productionConfigTemplate(): string {
  return JSON.stringify({ port: 8080 }, null, 2) + "\n";
}

function packageJsonTemplate(projectName: string, options: ResolvedOptions): string {
  const deps: Record<string, string> = {
    "@mantlejs/mantle": MANTLE_VERSION,
    "@mantlejs/express": MANTLE_VERSION,
    "@mantlejs/schema": MANTLE_VERSION,
    express: THIRD_PARTY_VERSIONS.express,
  };

  if (options.database === "pg") {
    deps["@mantlejs/knex"] = MANTLE_VERSION;
    deps["knex"] = THIRD_PARTY_VERSIONS.knex;
    deps["pg"] = THIRD_PARTY_VERSIONS.pg;
  } else if (options.database === "sqlite") {
    deps["@mantlejs/knex"] = MANTLE_VERSION;
    deps["knex"] = THIRD_PARTY_VERSIONS.knex;
    deps["better-sqlite3"] = THIRD_PARTY_VERSIONS["better-sqlite3"];
  } else if (options.database === "mongodb") {
    deps["@mantlejs/mongodb"] = MANTLE_VERSION;
    deps["mongodb"] = THIRD_PARTY_VERSIONS.mongodb;
  }

  if (options.auth !== "none") {
    deps["@mantlejs/auth"] = MANTLE_VERSION;
    deps["jsonwebtoken"] = THIRD_PARTY_VERSIONS.jsonwebtoken;

    if (options.auth === "local") {
      deps["@mantlejs/auth-local"] = MANTLE_VERSION;
      deps["@node-rs/argon2"] = THIRD_PARTY_VERSIONS["@node-rs/argon2"];
    } else if (OAUTH_AUTH_VALUES.has(options.auth)) {
      deps[OAUTH_STRATEGY_TEMPLATES[options.auth].packageName] = MANTLE_VERSION;
    }
  }

  if (options.redis) {
    deps["@mantlejs/auth-redis"] = MANTLE_VERSION;
    deps["ioredis"] = THIRD_PARTY_VERSIONS.ioredis;
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
      "@mantlejs/memory": MANTLE_VERSION,
      "@types/node": THIRD_PARTY_VERSIONS["@types/node"],
      tsx: THIRD_PARTY_VERSIONS.tsx,
      typescript: THIRD_PARTY_VERSIONS.typescript,
      vitest: THIRD_PARTY_VERSIONS.vitest,
    },
  };

  return JSON.stringify(pkg, null, 2) + "\n";
}

function tsconfigTemplate(): string {
  return (
    JSON.stringify(
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
    ) + "\n"
  );
}

function envExampleTemplate(options: ResolvedOptions): string {
  const lines = ["PORT=3030"];

  if (options.database === "pg") {
    lines.push("DATABASE_URL=postgres://user:password@localhost:5432/dbname");
  } else if (options.database === "mongodb") {
    lines.push("MONGODB_URI=mongodb://localhost:27017");
    lines.push("MONGODB_DB_NAME=app");
  }

  if (options.auth !== "none") {
    lines.push("JWT_SECRET=change-me");
  }

  if (OAUTH_AUTH_VALUES.has(options.auth)) {
    lines.push(...OAUTH_STRATEGY_TEMPLATES[options.auth].envVars);
  }

  if (options.redis) {
    lines.push("REDIS_URL=redis://localhost:6379");
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
