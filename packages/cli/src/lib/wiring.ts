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
  "@mantlejs/auth-apple": {
    imports: [{ names: ["appleStrategy"], path: "@mantlejs/auth-apple" }],
    configureCall:
      "appleStrategy({ clientId: process.env.APPLE_CLIENT_ID!, teamId: process.env.APPLE_TEAM_ID!, keyId: process.env.APPLE_KEY_ID!, privateKey: process.env.APPLE_PRIVATE_KEY! })",
    envVars: [
      "APPLE_CLIENT_ID=your-apple-services-id",
      "APPLE_TEAM_ID=your-apple-team-id",
      "APPLE_KEY_ID=your-apple-key-id",
      "APPLE_PRIVATE_KEY=your-apple-p8-private-key",
    ],
  },
  "@mantlejs/auth-microsoft": {
    imports: [{ names: ["microsoftStrategy"], path: "@mantlejs/auth-microsoft" }],
    configureCall:
      'microsoftStrategy({ clientId: process.env.MICROSOFT_CLIENT_ID!, clientSecret: process.env.MICROSOFT_CLIENT_SECRET!, tenant: process.env.MICROSOFT_TENANT ?? "common" })',
    envVars: [
      "MICROSOFT_CLIENT_ID=your-microsoft-client-id",
      "MICROSOFT_CLIENT_SECRET=your-microsoft-client-secret",
      "MICROSOFT_TENANT=common",
    ],
  },
  "@mantlejs/auth-linkedin": {
    imports: [{ names: ["linkedinStrategy"], path: "@mantlejs/auth-linkedin" }],
    configureCall:
      "linkedinStrategy({ clientId: process.env.LINKEDIN_CLIENT_ID!, clientSecret: process.env.LINKEDIN_CLIENT_SECRET! })",
    envVars: ["LINKEDIN_CLIENT_ID=your-linkedin-client-id", "LINKEDIN_CLIENT_SECRET=your-linkedin-client-secret"],
  },
  "@mantlejs/mongodb": {
    imports: [{ names: ["mongodb"], path: "@mantlejs/mongodb" }],
    configureCall: 'mongodb({ uri: process.env.MONGODB_URI!, dbName: process.env.MONGODB_DB_NAME ?? "app" })',
    envVars: ["MONGODB_URI=mongodb://localhost:27017", "MONGODB_DB_NAME=app"],
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
