import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { writeGeneratedFile, fileExists } from "../utils.js";

export interface AuthenticationGeneratorOptions {
  cwd?: string;
}

interface OAuthStrategyDef {
  packageName: string;
  importName: string;
  envPrefix: string;
  configFields: string[];
}

const OAUTH_STRATEGIES: OAuthStrategyDef[] = [
  {
    packageName: "@mantlejs/auth-google",
    importName: "googleStrategy",
    envPrefix: "GOOGLE",
    configFields: ["clientId: process.env.GOOGLE_CLIENT_ID!", "clientSecret: process.env.GOOGLE_CLIENT_SECRET!"],
  },
  {
    packageName: "@mantlejs/auth-github",
    importName: "githubStrategy",
    envPrefix: "GITHUB",
    configFields: ["clientId: process.env.GITHUB_CLIENT_ID!", "clientSecret: process.env.GITHUB_CLIENT_SECRET!"],
  },
  {
    packageName: "@mantlejs/auth-facebook",
    importName: "facebookStrategy",
    envPrefix: "FACEBOOK",
    configFields: [
      "clientId: process.env.FACEBOOK_CLIENT_ID!",
      "clientSecret: process.env.FACEBOOK_CLIENT_SECRET!",
    ],
  },
  {
    packageName: "@mantlejs/auth-apple",
    importName: "appleStrategy",
    envPrefix: "APPLE",
    configFields: [
      "clientId: process.env.APPLE_CLIENT_ID!",
      "teamId: process.env.APPLE_TEAM_ID!",
      "keyId: process.env.APPLE_KEY_ID!",
      "privateKey: process.env.APPLE_PRIVATE_KEY!",
    ],
  },
  {
    packageName: "@mantlejs/auth-microsoft",
    importName: "microsoftStrategy",
    envPrefix: "MICROSOFT",
    configFields: [
      "clientId: process.env.MICROSOFT_CLIENT_ID!",
      "clientSecret: process.env.MICROSOFT_CLIENT_SECRET!",
      'tenant: process.env.MICROSOFT_TENANT ?? "common"',
    ],
  },
  {
    packageName: "@mantlejs/auth-linkedin",
    importName: "linkedinStrategy",
    envPrefix: "LINKEDIN",
    configFields: [
      "clientId: process.env.LINKEDIN_CLIENT_ID!",
      "clientSecret: process.env.LINKEDIN_CLIENT_SECRET!",
    ],
  },
];

interface AuthPackages {
  hasAuth: boolean;
  hasLocal: boolean;
  hasRedis: boolean;
  oauthStrategies: OAuthStrategyDef[];
}

async function detectAuthPackages(cwd: string): Promise<AuthPackages> {
  const pkgPath = join(cwd, "package.json");
  if (!(await fileExists(pkgPath))) {
    return { hasAuth: false, hasLocal: false, hasRedis: false, oauthStrategies: [] };
  }

  const raw = await readFile(pkgPath, "utf-8");
  const pkg = JSON.parse(raw) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };

  return {
    hasAuth: "@mantlejs/auth" in deps,
    hasLocal: "@mantlejs/auth-local" in deps,
    hasRedis: "@mantlejs/auth-redis" in deps,
    oauthStrategies: OAUTH_STRATEGIES.filter((strategy) => strategy.packageName in deps),
  };
}

export async function generateAuthentication(options: AuthenticationGeneratorOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const authPkgs = await detectAuthPackages(cwd);

  const outPath = join(cwd, "src/authentication.ts");
  const content = authenticationTemplate(authPkgs);
  await writeGeneratedFile(outPath, content);

  console.log("\n  Wire it into src/app.ts:");
  console.log('    import "./authentication.js";');

  if (authPkgs.hasLocal) {
    console.log("\n  Or use localStrategy() directly:");
    console.log('    import { localStrategy } from "@mantlejs/auth-local";');
    console.log("    app.configure(localStrategy());");
  }
  for (const strategy of authPkgs.oauthStrategies) {
    console.log(`\n  Or use ${strategy.importName}() directly:`);
    console.log(`    import { ${strategy.importName} } from "${strategy.packageName}";`);
    console.log(`    app.configure(${strategy.importName}({ ${strategy.configFields.join(", ")} }));`);
  }
  if (authPkgs.hasRedis) {
    console.log("\n  @mantlejs/auth-redis detected — pass redisStateStore()/redisRefreshTokenStore() into");
    console.log("  the strategy/auth() config to share OAuth state and refresh tokens across instances.");
  }
  console.log();
}

function authenticationTemplate(pkgs: AuthPackages): string {
  const imports: string[] = ['import { app } from "./app.js";'];
  const configures: string[] = [];

  if (pkgs.hasAuth) {
    imports.push('import { auth } from "@mantlejs/auth";');
    configures.push("app.configure(auth({ secret: process.env.JWT_SECRET! }));");
  }

  if (pkgs.hasLocal) {
    imports.push('import { localStrategy } from "@mantlejs/auth-local";');
    configures.push("app.configure(localStrategy());");
  }

  for (const strategy of pkgs.oauthStrategies) {
    imports.push(`import { ${strategy.importName} } from "${strategy.packageName}";`);
    configures.push(`app.configure(${strategy.importName}({ ${strategy.configFields.join(", ")} }));`);
  }

  if (configures.length === 0) {
    configures.push("// No @mantlejs/auth-* packages detected.");
    configures.push("// Install one first: npm install @mantlejs/auth @mantlejs/auth-local");
  }

  return `${imports.join("\n")}

${configures.join("\n")}
`;
}
