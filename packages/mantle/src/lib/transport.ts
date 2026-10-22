import { randomUUID } from "node:crypto";
import { MantleError } from "./errors.js";
import type { HttpResponseMeta } from "./types.js";

/** Response header carrying the request ID. Read from the request when valid, else generated. */
export const REQUEST_ID_HEADER = "X-Request-Id";

/** @deprecated Read `X-Request-Id` instead. Still accepted (and echoed back when sent) for one release. */
export const LEGACY_CORRELATION_ID_HEADER = "X-Correlation-Id";

/**
 * Client-supplied request IDs land in logs and response headers, so only short tokens of
 * header-safe characters are accepted — enough for UUIDs, ULIDs, base64 ids, and proxy formats
 * like AWS's `Root=1-…`. Anything else is replaced with a generated UUID rather than rejected.
 */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._~:@=+/-]{1,128}$/;

export interface ResolvedRequestId {
  requestId: string;
  /** True when the caller sent the deprecated `X-Correlation-Id` (and no valid `X-Request-Id`). Echo it back. */
  legacy: boolean;
}

/**
 * Resolve the request ID for an incoming request: a valid `X-Request-Id`, else a valid legacy
 * `X-Correlation-Id`, else a fresh UUID. `getHeader` receives lower-case header names.
 * Shared by all three HTTP transports so validation and fallback order can't drift between them.
 */
export function resolveRequestId(getHeader: (name: string) => string | string[] | undefined): ResolvedRequestId {
  const requestId = firstValue(getHeader("x-request-id"));
  if (requestId !== undefined && REQUEST_ID_PATTERN.test(requestId)) return { requestId, legacy: false };
  const correlationId = firstValue(getHeader("x-correlation-id"));
  if (correlationId !== undefined && REQUEST_ID_PATTERN.test(correlationId)) {
    return { requestId: correlationId, legacy: true };
  }
  return { requestId: randomUUID(), legacy: false };
}

/** Response headers echoing a resolved request ID — `X-Request-Id`, plus `X-Correlation-Id` for legacy callers. */
export function requestIdHeaders({ requestId, legacy }: ResolvedRequestId): Record<string, string> {
  return legacy
    ? { [REQUEST_ID_HEADER]: requestId, [LEGACY_CORRELATION_ID_HEADER]: requestId }
    : { [REQUEST_ID_HEADER]: requestId };
}

/**
 * Which proxies to trust when reading the client address from `X-Forwarded-For`. Mirrors Express's
 * `trust proxy`: `false` (default) ignores the header; `true` takes its leftmost entry, which the
 * client controls, so only use it when the proxy in front overwrites the header; a number trusts
 * that many proxy hops, counting the direct peer as the first, and is the safe choice behind a load
 * balancer that appends (e.g. `1` on Cloud Run or behind one nginx).
 */
export type TrustProxy = boolean | number;

/**
 * Resolve `params.ip` from the socket's peer address and the `X-Forwarded-For` header.
 * IPv4-mapped IPv6 addresses (`::ffff:10.0.0.1`) are normalized to plain IPv4.
 */
export function resolveClientIp(
  remoteAddress: string | undefined,
  forwardedFor: string | string[] | undefined,
  trustProxy: TrustProxy = false,
): string | undefined {
  if (trustProxy === false || (typeof trustProxy === "number" && trustProxy <= 0)) return normalizeIp(remoteAddress);
  const forwarded = parseForwardedFor(forwardedFor);
  if (forwarded.length === 0) return normalizeIp(remoteAddress);
  if (trustProxy === true) return normalizeIp(forwarded[0]);
  // The peer is hop 1 even when unknown (Fetch API handlers), so the same `trustProxy` picks the same
  // entry on Node and edge runtimes; with trustProxy >= 1 the index never lands on the peer slot itself.
  const chain = [...forwarded, remoteAddress];
  return normalizeIp(chain[Math.max(0, chain.length - 1 - trustProxy)]);
}

/** Statuses whose responses carry no body — the transports send headers only. */
export function isBodylessStatus(status: number): boolean {
  return status === 204 || status === 304;
}

/**
 * The status and headers an HTTP transport sends for a successful service call: `context.http`
 * (copied into `response` by the pipeline) overrides the route's default status.
 */
export function successResponse(
  response: HttpResponseMeta,
  defaultStatus: number,
): { status: number; headers: Record<string, string>; bodyless: boolean } {
  const status = response.status ?? defaultStatus;
  return { status, headers: response.headers ?? {}, bodyless: isBodylessStatus(status) };
}

/**
 * The headers an HTTP transport sends with an error response: everything hooks set on
 * `context.http.headers` before the error (e.g. `RateLimit`), with the error's own
 * `MantleError.headers` (e.g. `Retry-After`) taking precedence. The status always comes from the error.
 */
export function errorResponseHeaders(response: HttpResponseMeta | undefined, err: unknown): Record<string, string> {
  return { ...response?.headers, ...(err instanceof MantleError ? err.headers : undefined) };
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseForwardedFor(value: string | string[] | undefined): string[] {
  const joined = Array.isArray(value) ? value.join(",") : value;
  if (!joined) return [];
  return joined
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function normalizeIp(address: string | undefined): string | undefined {
  return address?.startsWith("::ffff:") && address.includes(".") ? address.slice("::ffff:".length) : address;
}
