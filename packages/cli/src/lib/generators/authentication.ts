import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { writeGeneratedFile, fileExists } from "../utils.js";

export interface AuthenticationGeneratorOptions {
  cwd?: string;
}

interface AuthPackages {
  hasAuth: boolean;
  hasLocal: boolean;
  hasGoogle: boolean;
  hasGitHub: boolean;
  hasFacebook: boolean;
}

async function detectAuthPackages(cwd: string): Promise<AuthPackages> {
  const pkgPath = join(cwd, "package.json");
  if (!(await fileExists(pkgPath))) {
    return { hasAuth: false, hasLocal: false, hasGoogle: false, hasGitHub: false, hasFacebook: false };
  }

  const raw = await readFile(pkgPath, "utf-8");
  const pkg = JSON.parse(raw) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };

  return {
    hasAuth: "@mantlejs/auth" in deps,
    hasLocal: "@mantlejs/auth-local" in deps,
    hasGoogle: "@mantlejs/auth-google" in deps,
    hasGitHub: "@mantlejs/auth-github" in deps,
    hasFacebook: "@mantlejs/auth-facebook" in deps,
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
  if (authPkgs.hasGoogle) {
    console.log("\n  Or use googleStrategy() directly:");
    console.log('    import { googleStrategy } from "@mantlejs/auth-google";');
    console.log("    app.configure(googleStrategy({ clientId: ..., clientSecret: ... }));");
  }
  if (authPkgs.hasGitHub) {
    console.log("\n  Or use githubStrategy() directly:");
    console.log('    import { githubStrategy } from "@mantlejs/auth-github";');
    console.log("    app.configure(githubStrategy({ clientId: ..., clientSecret: ... }));");
  }
  if (authPkgs.hasFacebook) {
    console.log("\n  Or use facebookStrategy() directly:");
    console.log('    import { facebookStrategy } from "@mantlejs/auth-facebook";');
    console.log("    app.configure(facebookStrategy({ clientId: ..., clientSecret: ... }));");
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

  if (pkgs.hasGoogle) {
    imports.push('import { googleStrategy } from "@mantlejs/auth-google";');
    configures.push(
      "app.configure(googleStrategy({ clientId: process.env.GOOGLE_CLIENT_ID!, clientSecret: process.env.GOOGLE_CLIENT_SECRET! }));",
    );
  }

  if (pkgs.hasGitHub) {
    imports.push('import { githubStrategy } from "@mantlejs/auth-github";');
    configures.push(
      "app.configure(githubStrategy({ clientId: process.env.GITHUB_CLIENT_ID!, clientSecret: process.env.GITHUB_CLIENT_SECRET! }));",
    );
  }

  if (pkgs.hasFacebook) {
    imports.push('import { facebookStrategy } from "@mantlejs/auth-facebook";');
    configures.push(
      "app.configure(facebookStrategy({ clientId: process.env.FACEBOOK_CLIENT_ID!, clientSecret: process.env.FACEBOOK_CLIENT_SECRET! }));",
    );
  }

  if (configures.length === 0) {
    configures.push("// No @mantlejs/auth-* packages detected.");
    configures.push("// Install one first: npm install @mantlejs/auth @mantlejs/auth-local");
  }

  return `${imports.join("\n")}

${configures.join("\n")}
`;
}
