import type { HookContext, HookFunction } from "@mantlejs/mantle";
import { BadRequest, TooManyRequests } from "@mantlejs/mantle";
import {
  assertPolicyName,
  limitItem,
  mergeListItem,
  policyItem,
  RATE_LIMIT_HEADER,
  RATE_LIMIT_POLICY_HEADER,
} from "./headers.js";
import { byPrincipal, type RateLimitKey } from "./keys.js";
import { memoryStore, type RateLimitStore } from "./stores.js";

export interface RateLimitOptions {
  /**
   * Policy name, sent in the `RateLimit` headers. One counter per policy and key: registering the same policy on
   * several services makes them share one budget. @default "default"
   */
  policy?: string;
  /** Quota per window (in cost units; one per call by default). */
  limit: number;
  /** Window length in whole seconds. */
  windowSeconds: number;
  /** Who a call counts against. @default byPrincipal() — agent, else user, else IP */
  key?: RateLimitKey;
  /** Where counters live. @default a `memoryStore()` per hook — single instance only; use `redisStore()` behind a load balancer */
  store?: RateLimitStore;
  /** What a call costs against the quota. @default 1 */
  cost?: number | ((context: HookContext) => number);
  /** Count internal calls (`provider` undefined) too. @default false — server-side calls aren't the client's budget */
  includeInternal?: boolean;
}

/**
 * A fixed-window rate limit, as a before hook. Each call adds its cost to the counter for `policy` + `key`; while the
 * total is within `limit`, the call proceeds with `RateLimit-Policy` and `RateLimit` response headers
 * (draft-ietf-httpapi-ratelimit-headers-11). Over the limit it throws `TooManyRequests` (429) carrying `Retry-After`,
 * so HTTP clients know when to retry and MCP agents read the delay from the error.
 *
 * ```ts
 * app.service("articles").hooks({
 *   before: {
 *     all: [rateLimit({ limit: 100, windowSeconds: 60 })],
 *     create: [rateLimit({ policy: "writes", limit: 10, windowSeconds: 60, store: redisStore(redis) })],
 *   },
 * });
 * ```
 */
export function rateLimit(options: RateLimitOptions): HookFunction {
  const { limit, windowSeconds, includeInternal = false } = options;
  const policy = options.policy ?? "default";
  assertPolicyName(policy);
  for (const [name, value] of [
    ["limit", limit],
    ["windowSeconds", windowSeconds],
  ] as const) {
    if (!Number.isInteger(value) || value < 1) {
      throw new BadRequest(`rateLimit() ${name} must be a positive integer, got ${String(value)}`);
    }
  }
  const key = options.key ?? byPrincipal();
  const store = options.store ?? memoryStore();
  const policyHeader = policyItem(policy, limit, windowSeconds);

  return async (context) => {
    if (context.provider === undefined && !includeInternal) return context;
    const caller = key(context);
    if (caller === undefined) return context;

    const cost = typeof options.cost === "function" ? options.cost(context) : (options.cost ?? 1);
    const { count, resetSeconds } = await store.hit(`${policy}:${caller}`, windowSeconds, cost);
    const retryAfter = Math.max(1, Math.ceil(resetSeconds));

    // Mutate in place: the headers then survive this hook's own throw (and any later error) via context.http.
    const headers = context.http?.headers ?? {};
    headers[RATE_LIMIT_POLICY_HEADER] = mergeListItem(headers[RATE_LIMIT_POLICY_HEADER], policyHeader);
    headers[RATE_LIMIT_HEADER] = mergeListItem(
      headers[RATE_LIMIT_HEADER],
      limitItem(policy, limit - count, resetSeconds),
    );
    context.http = { ...context.http, headers };

    if (count > limit) {
      throw Object.assign(
        new TooManyRequests(
          `Rate limit '${policy}' exceeded: ${limit} per ${windowSeconds}s. Retry after ${retryAfter}s.`,
          { policy, limit, windowSeconds, retryAfter },
          undefined,
          `Wait ${retryAfter} seconds (the Retry-After header) before retrying.`,
        ),
        { headers: { ...headers, "Retry-After": String(retryAfter) } },
      );
    }
    return context;
  };
}
