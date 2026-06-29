export interface ImportEntry {
  defaultImport?: string;
  names?: string[];
  path: string;
}

export interface PackageWiring {
  imports: ImportEntry[];
  configureCall: string;
  envVars?: string[];
}

export const PACKAGE_WIRINGS: Record<string, PackageWiring> = {
  "@mantlejs/logger": {
    imports: [
      { defaultImport: "pino", path: "pino" },
      { names: ["logger", "pinoAdapter"], path: "@mantlejs/logger" },
    ],
    configureCall: `logger(pinoAdapter(pino({ level: process.env.LOG_LEVEL ?? "info" })))`,
    envVars: ["LOG_LEVEL=info"],
  },
  "@mantlejs/socketio": {
    imports: [{ names: ["socketio"], path: "@mantlejs/socketio" }],
    configureCall: "socketio()",
  },
  "@mantlejs/koa": {
    imports: [{ names: ["koa"], path: "@mantlejs/koa" }],
    configureCall: "koa()",
  },
  "@mantlejs/auth": {
    imports: [{ names: ["auth"], path: "@mantlejs/auth" }],
    configureCall: "auth({ secret: process.env.JWT_SECRET! })",
    envVars: ["JWT_SECRET=change-me"],
  },
  "@mantlejs/auth-local": {
    imports: [{ names: ["localStrategy"], path: "@mantlejs/auth-local" }],
    configureCall: "localStrategy()",
  },
  "@mantlejs/auth-google": {
    imports: [{ names: ["googleStrategy"], path: "@mantlejs/auth-google" }],
    configureCall:
      "googleStrategy({ clientId: process.env.GOOGLE_CLIENT_ID!, clientSecret: process.env.GOOGLE_CLIENT_SECRET! })",
    envVars: ["GOOGLE_CLIENT_ID=your-google-client-id", "GOOGLE_CLIENT_SECRET=your-google-client-secret"],
  },
  "@mantlejs/auth-github": {
    imports: [{ names: ["githubStrategy"], path: "@mantlejs/auth-github" }],
    configureCall:
      "githubStrategy({ clientId: process.env.GITHUB_CLIENT_ID!, clientSecret: process.env.GITHUB_CLIENT_SECRET! })",
    envVars: ["GITHUB_CLIENT_ID=your-github-client-id", "GITHUB_CLIENT_SECRET=your-github-client-secret"],
  },
  "@mantlejs/auth-facebook": {
    imports: [{ names: ["facebookStrategy"], path: "@mantlejs/auth-facebook" }],
    configureCall:
      "facebookStrategy({ clientId: process.env.FACEBOOK_CLIENT_ID!, clientSecret: process.env.FACEBOOK_CLIENT_SECRET! })",
    envVars: ["FACEBOOK_CLIENT_ID=your-facebook-client-id", "FACEBOOK_CLIENT_SECRET=your-facebook-client-secret"],
  },
  "@mantlejs/sync": {
    imports: [{ names: ["sync", "redisAdapter"], path: "@mantlejs/sync" }],
    configureCall: "sync({ adapter: redisAdapter({ url: process.env.REDIS_URL }) })",
    envVars: ["REDIS_URL=redis://localhost:6379"],
  },
  "@mantlejs/config": {
    imports: [{ names: ["config"], path: "@mantlejs/config" }],
    configureCall: "config()",
  },
};
