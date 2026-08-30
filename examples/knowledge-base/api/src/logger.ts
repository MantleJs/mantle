import { createLogger } from "@mantlejs/logger";
import type { Logger } from "@mantlejs/mantle";

/**
 * `createLogger()` is async (it validates the optional `pino` peer is installed) — kept
 * separate from the otherwise-synchronous `createApp()` so tests can build an app without
 * awaiting anything. The real entrypoint (`index.ts`) calls this and passes the result in.
 */
export function createProductionLogger(): Promise<Logger> {
  return createLogger({ gcp: process.env.NODE_ENV === "production" });
}
