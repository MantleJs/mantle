import type { CorsOptions } from "@mantlejs/mantle";
import { CORS_DEFAULT_METHODS, resolveCorsOrigin } from "@mantlejs/mantle";

export interface CorsResult {
  /** Headers to attach to the response. Non-empty only when the origin is allowed. */
  headers: Record<string, string>;
  /** True for an OPTIONS preflight request — the caller should respond 204 immediately, skipping dispatch. */
  isPreflight: boolean;
}

/**
 * Compute CORS response headers for a request, hand-rolled since `@mantlejs/http` has no
 * framework to delegate to. Mirrors the behavior `@mantlejs/express` gets from `cors` and
 * `@mantlejs/koa` gets from `@koa/cors`: an allowed origin gets `Access-Control-Allow-Origin`
 * (+ credentials/expose-headers) on every response, and an `OPTIONS` preflight additionally
 * gets `Access-Control-Allow-Methods` / `-Headers` / `-Max-Age` and should short-circuit with 204.
 */
export function buildCorsHeaders(
  options: CorsOptions,
  method: string,
  requestOrigin: string | undefined,
  requestedHeaders: string | undefined,
): CorsResult {
  const allowOrigin = resolveCorsOrigin(options.origin, requestOrigin);
  if (allowOrigin === undefined) {
    return { headers: {}, isPreflight: false };
  }

  const headers: Record<string, string> = { "Access-Control-Allow-Origin": allowOrigin };
  if (allowOrigin !== "*") {
    headers["Vary"] = "Origin";
  }
  if (options.credentials) {
    headers["Access-Control-Allow-Credentials"] = "true";
  }

  const isPreflight = method === "OPTIONS";
  if (isPreflight) {
    // Comma-only join (no space) to match the `cors` and `@koa/cors` packages' formatting exactly.
    headers["Access-Control-Allow-Methods"] = (options.methods ?? CORS_DEFAULT_METHODS).join(",");
    const allowHeaders = options.allowedHeaders?.length ? options.allowedHeaders.join(",") : requestedHeaders;
    if (allowHeaders) {
      headers["Access-Control-Allow-Headers"] = allowHeaders;
    }
    if (options.maxAge !== undefined) {
      headers["Access-Control-Max-Age"] = String(options.maxAge);
    }
  } else if (options.exposedHeaders?.length) {
    headers["Access-Control-Expose-Headers"] = options.exposedHeaders.join(",");
  }

  return { headers, isPreflight };
}
