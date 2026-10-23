import { createHash } from "node:crypto";
import { PreconditionFailed } from "./errors.js";
import type { HookContext, HookFunction } from "./types.js";

export interface ConditionalOptions {
  /**
   * A field that changes on every write (e.g. `updatedAt` with repository timestamps, or an integer `version` your
   * app increments). The ETag is derived from it, and writes made through `RepositoryService` include it in their
   * where clause, so a concurrent write loses cleanly instead of being overwritten. Without it, the ETag is a hash of
   * the serialized result and the check-then-write isn't atomic.
   */
  versionField?: string;
  /** Reject `update`/`patch`/`remove` that don't send `If-Match` (412 with a hint). @default false */
  requireIfMatch?: boolean;
}

export interface ConditionalHooks {
  /** Register in `before` for `update`/`patch`/`remove` (or `all`): checks `If-Match`. */
  before: HookFunction;
  /** Register last in `after` for `get`/`update`/`patch` (or `all`): sets `ETag`, and answers `If-None-Match` with 304. */
  after: HookFunction;
}

const WRITE_METHODS = new Set(["update", "patch", "remove"]);
const ETAG_METHODS = new Set(["get", "update", "patch"]);
/** Characters allowed inside an entity tag (RFC 9110 §8.8.3 `etagc`, minus obs-text). */
const ETAG_SAFE = /^[\x21\x23-\x7e]+$/;

/**
 * HTTP conditional requests (RFC 9110 §13): `ETag` on `get`, `304 Not Modified` for a matching `If-None-Match`, and
 * `412 Precondition Failed` when an `update`/`patch`/`remove` carries an `If-Match` that no longer matches. `find` is
 * not covered (a list ETag needs a cache strategy).
 *
 * ```ts
 * const etags = conditional({ versionField: "updatedAt" });
 * app.service("articles").hooks({ before: { all: [etags.before] }, after: { all: [etags.after] } });
 * ```
 *
 * ETags are strong (`"…"`): `If-Match` must use strong comparison, so a weak ETag could never satisfy it.
 * Non-HTTP callers (socket.io, MCP, internal calls) send no conditional headers, so the hooks only add an ETag the
 * transport ignores.
 */
export function conditional(options: ConditionalOptions = {}): ConditionalHooks {
  const { versionField, requireIfMatch = false } = options;
  const etagOf = (record: unknown): string => entityTag(record, versionField);

  const before: HookFunction = async (context) => {
    if (!WRITE_METHODS.has(context.method) || context.id === undefined) return context;
    const ifMatch = header(context, "if-match");
    if (ifMatch === undefined) {
      if (!requireIfMatch) return context;
      throw new PreconditionFailed(
        `'${context.method}' on '${context.path}' requires an If-Match header`,
        undefined,
        undefined,
        "Fetch the record, then send its ETag in If-Match so a concurrent change isn't overwritten.",
      );
    }

    // Read the record the way a GET does (same params, same hooks), so the ETag matches the one the caller saw.
    const current = await context.app.service(context.path).get(context.id, { ...context.params });
    if (!matchesIfMatch(ifMatch, etagOf(current))) {
      throw new PreconditionFailed(
        "The resource has changed since it was read",
        undefined,
        undefined,
        "Fetch the record again to get its current ETag, re-apply your change, and retry with the new If-Match.",
      );
    }

    const version = versionField !== undefined ? fieldOf(current, versionField) : undefined;
    if (version === undefined) return context;
    // Picked up by RepositoryService, whose repository adds it to the write's where clause (Decision #10).
    context.params = { ...context.params, precondition: { where: { [versionField as string]: version } } };
    return context;
  };

  const after: HookFunction = (context) => {
    if (!ETAG_METHODS.has(context.method) || !isRecord(context.result)) return context;
    const etag = etagOf(context.result);
    const notModified = context.method === "get" && matchesIfNoneMatch(header(context, "if-none-match"), etag);
    context.http = {
      ...context.http,
      ...(notModified ? { status: 304 } : {}),
      headers: { ...context.http?.headers, ETag: etag },
    };
    return context;
  };

  return { before, after };
}

/** A strong entity tag for a record: its version when one is configured and present, else a hash of its JSON. */
export function entityTag(record: unknown, versionField?: string): string {
  const version = versionField !== undefined ? fieldOf(record, versionField) : undefined;
  if (version !== undefined) {
    const text = version instanceof Date ? version.toISOString() : String(version);
    return `"${ETAG_SAFE.test(text) ? text : hash(text)}"`;
  }
  return `"${hash(canonicalJson(record))}"`;
}

/** `If-None-Match` uses weak comparison: `W/"x"` and `"x"` match. `*` matches any current representation. */
export function matchesIfNoneMatch(headerValue: string | undefined, etag: string): boolean {
  if (headerValue === undefined) return false;
  const opaque = stripWeak(etag);
  return parseEntityTags(headerValue).some((tag) => tag === "*" || stripWeak(tag) === opaque);
}

/** `If-Match` uses strong comparison: a weak tag never matches. `*` matches any existing record. */
export function matchesIfMatch(headerValue: string, etag: string): boolean {
  return parseEntityTags(headerValue).some((tag) => tag === "*" || (!tag.startsWith("W/") && tag === etag));
}

function parseEntityTags(value: string): string[] {
  return value.match(/(?:W\/)?"[^"]*"|\*/g) ?? [];
}

function stripWeak(tag: string): string {
  return tag.startsWith("W/") ? tag.slice(2) : tag;
}

function header(context: HookContext, name: string): string | undefined {
  const value = context.params.headers?.[name] as string | string[] | undefined;
  return Array.isArray(value) ? value.join(", ") : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fieldOf(record: unknown, field: string): unknown {
  return isRecord(record) ? record[field] : undefined;
}

function hash(text: string): string {
  return createHash("sha256").update(text).digest("base64url").slice(0, 27);
}

/** JSON with object keys sorted, so the same record always hashes the same however its keys were ordered. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, nested: unknown) =>
    isRecord(nested)
      ? Object.fromEntries(
          Object.keys(nested)
            .sort()
            .map((key) => [key, nested[key]]),
        )
      : nested,
  );
}
