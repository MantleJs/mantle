/**
 * Single source of truth for dependency versions written into scaffolded `package.json` files.
 * Every `@mantlejs/*` package in this workspace releases in lockstep (`nx release`, fixed group),
 * so one constant covers all of them. Third-party pins mirror the peer-dependency ranges declared
 * by the corresponding `@mantlejs/*` package.
 */

/** Version written for every `@mantlejs/*` dependency — matches the workspace's lockstep release version. */
export const MANTLE_VERSION = "^0.0.1";

/** Third-party package versions used across scaffolded templates, kept aligned with peer ranges. */
export const THIRD_PARTY_VERSIONS = {
  express: "^5.0.0",
  knex: "^3.0.0",
  pg: "^8.0.0",
  "better-sqlite3": "^11.0.0",
  mongodb: "^6.0.0",
  jsonwebtoken: "^9.0.0",
  "@node-rs/argon2": "^2.0.0",
  ioredis: "^5.4.1",
  "@types/node": "^20.19.0",
  tsx: "^4.0.0",
  typescript: "^5.9.0",
  vitest: "^4.1.0",
} as const;

export type ThirdPartyPackage = keyof typeof THIRD_PARTY_VERSIONS;
