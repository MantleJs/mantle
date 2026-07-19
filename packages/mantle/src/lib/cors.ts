import type { CorsOptions } from "./types.js";

/** Default `Access-Control-Allow-Methods` list for `cors: true` — the CRUD verbs Mantle service routes use. */
export const CORS_DEFAULT_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

/**
 * Resolve `CorsOptions.origin` against a request's `Origin` header into the concrete value to send back
 * as `Access-Control-Allow-Origin`, or `undefined` when the origin is disallowed (no CORS headers should
 * be sent). Shared by all three HTTP transports so `origin: true` (reflect), a fixed string, an allow-list,
 * and a custom function all behave identically regardless of which transport is mounted.
 */
export function resolveCorsOrigin(
  origin: CorsOptions["origin"],
  requestOrigin: string | undefined,
): string | undefined {
  const value = origin ?? true;
  const resolved = typeof value === "function" ? value(requestOrigin) : value;
  if (resolved === false) return undefined;
  if (resolved === true) return requestOrigin ?? "*";
  if (Array.isArray(resolved)) {
    return requestOrigin !== undefined && resolved.includes(requestOrigin) ? requestOrigin : undefined;
  }
  return resolved;
}
