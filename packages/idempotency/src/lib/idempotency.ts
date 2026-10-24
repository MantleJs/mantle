import { createHash } from "node:crypto";
import type { HookContext, HookFunction, Repository } from "@mantlejs/mantle";
import { BadRequest, Conflict, Unprocessable } from "@mantlejs/mantle";

/** The record kept per idempotency key. Every field is a string or a number, so any adapter can store it as-is. */
export interface IdempotencyRecord extends Record<string, unknown> {
  /** Derived from the caller's scope and key — never the raw key, so keys from different callers can't collide. */
  id: string;
  /** SHA-256 of the method, path, id, and canonical data — a reused key with a different request is rejected. */
  fingerprint: string;
  status: "in-progress" | "completed";
  /** The result the caller received, as JSON. Set once the call completes. */
  response?: string;
  /** RFC 3339. The key is free to reuse after this. */
  expiresAt: string;
}

export interface IdempotencyOptions {
  /**
   * Where records live: any `Repository<IdempotencyRecord>` whose `save()` throws `Conflict` atomically on a duplicate
   * id — memory, knex (every client), supabase, mongodb, dynamodb. Not pinecone or qdrant: they overwrite.
   */
  store: Repository<IdempotencyRecord>;
  /** Reject `create`/`patch` calls that don't send a key, with `BadRequest`. @default false */
  required?: boolean;
  /** How long a completed result is replayed for. @default 86400 (24 hours) */
  ttlSeconds?: number;
  /**
   * Shape of record ids. `"hex"` is the 64-character SHA-256; `"objectid"` is its first 24 characters, a valid MongoDB
   * ObjectId (96 bits — still collision-free in practice). @default "hex"
   */
  idFormat?: "hex" | "objectid";
}

export interface IdempotencyHooks {
  /** Register **last** in `before` for `create`/`patch`: reserves the key, or replays the stored result. */
  before: HookFunction;
  /** Register **last** in `after`: stores exactly what the caller received. */
  after: HookFunction;
  /** Register in `error`: releases the key so the caller can retry — errors aren't cached. */
  error: HookFunction;
}

/** `create` and `patch` aren't idempotent by definition; `update` (a full replace) and `remove` already are. */
const PROTECTED_METHODS = new Set(["create", "patch"]);
/** Keys are opaque client tokens. Printable ASCII keeps them safe in logs and headers; 255 is Stripe's limit too. */
const KEY_PATTERN = /^[\x21-\x7e]{1,255}$/;
const REPLAYED_HEADER = "Idempotent-Replayed";

/** Per-call bookkeeping, carried from `before` to `after`/`error` on the params (spread-safe, as a symbol key). */
const STATE = Symbol("mantle.idempotency");
interface CallState {
  recordId: string;
  replayed: boolean;
}

/**
 * `Idempotency-Key` support (draft-ietf-httpapi-idempotency-key-header, Stripe semantics): a client that retries a
 * `create` or `patch` with the same key gets the first call's result back instead of a second write.
 *
 * ```ts
 * const guard = idempotency({ store: new IdempotencyRepository(app), required: true });
 * app.service("payments").hooks({
 *   before: { create: [guard.before] },
 *   after: { create: [guard.after] },
 *   error: { create: [guard.error] },
 * });
 * ```
 *
 * - The key comes from the `Idempotency-Key` header, or `params.idempotencyKey` (internal calls, MCP, the client SDK).
 * - Reserving the key is the store's atomic duplicate-id `save()`: of two concurrent calls with one key, exactly one
 *   runs; the other gets `Conflict` (409) while the first is in flight.
 * - The same key with a different request (method, path, id, or data) is `Unprocessable` (422).
 * - A replay sets `Idempotent-Replayed: true`, skips the service call, and emits no second `service:event`.
 * - Keys are scoped per principal (agent, else user) and per service method, so one caller's key never replays
 *   another's response. Anonymous callers share one scope: their keys must be unguessable (UUIDs).
 * - Other methods pass straight through, so registering the hooks on `all` is safe.
 */
export function idempotency(options: IdempotencyOptions): IdempotencyHooks {
  const { store, required = false, ttlSeconds = 86_400, idFormat = "hex" } = options;
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1) {
    throw new BadRequest(`idempotency() ttlSeconds must be a positive integer, got ${String(ttlSeconds)}`);
  }

  const before: HookFunction = async (context) => {
    if (!PROTECTED_METHODS.has(context.method)) return context;
    const key = idempotencyKey(context);
    if (key === undefined) {
      if (!required) return context;
      throw new BadRequest(
        `'${context.method}' on '${context.path}' requires an Idempotency-Key`,
        undefined,
        undefined,
        "Send an Idempotency-Key header with a unique value (e.g. a UUID), and reuse it when retrying this request.",
      );
    }
    if (!KEY_PATTERN.test(key)) {
      throw new BadRequest("Idempotency-Key must be 1–255 printable ASCII characters, without spaces");
    }

    const recordId = recordIdFor(context, key, idFormat);
    const fingerprint = fingerprintOf(context);
    const existing = await reserve(store, { id: recordId, fingerprint, ttlSeconds });
    if (existing === undefined) {
      context.params = { ...context.params, [STATE]: { recordId, replayed: false } satisfies CallState };
      return context;
    }

    if (existing.fingerprint !== fingerprint) {
      throw new Unprocessable(
        "This Idempotency-Key was already used for a different request",
        undefined,
        undefined,
        "Use a new Idempotency-Key for a new request; reuse a key only to retry the exact same request.",
      );
    }
    if (existing.status !== "completed" || existing.response === undefined) {
      throw new Conflict(
        "A request with this Idempotency-Key is still being processed",
        undefined,
        undefined,
        "Wait for the first request to finish, then retry with the same Idempotency-Key to get its result.",
      );
    }

    context.result = JSON.parse(existing.response) as HookContext["result"];
    context.event = null; // the first call already broadcast its event
    context.http = { ...context.http, headers: { ...context.http?.headers, [REPLAYED_HEADER]: "true" } };
    context.params = { ...context.params, [STATE]: { recordId, replayed: true } satisfies CallState };
    return context;
  };

  const after: HookFunction = async (context) => {
    const state = stateOf(context);
    if (!state || state.replayed) return context;
    try {
      await store.patchById(state.recordId, { status: "completed", response: JSON.stringify(context.result ?? null) });
    } catch {
      // The write already happened; failing the response now would make the client retry it. Release the key
      // instead (best effort): a retry then runs again, as it would without this hook, rather than being locked
      // out with 409 until the record expires.
      await store.deleteById(state.recordId).catch(() => undefined);
    }
    return context;
  };

  const error: HookFunction = async (context) => {
    const state = stateOf(context);
    if (state && !state.replayed) await store.deleteById(state.recordId).catch(() => undefined);
    return context;
  };

  return { before, after, error };
}

/**
 * Atomically claim `id` with an in-progress record. Returns `undefined` when this call now owns the key, else the live
 * record that already holds it. An expired record is removed and the claim retried once.
 */
async function reserve(
  store: Repository<IdempotencyRecord>,
  claim: { id: string; fingerprint: string; ttlSeconds: number },
): Promise<IdempotencyRecord | undefined> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const expiresAt = new Date(Date.now() + claim.ttlSeconds * 1000).toISOString();
    try {
      await store.save({ id: claim.id, fingerprint: claim.fingerprint, status: "in-progress", expiresAt });
      return undefined;
    } catch (err) {
      if (!(err instanceof Conflict)) throw err;
    }
    const existing = await store.findById(claim.id);
    if (existing && Date.parse(existing.expiresAt) > Date.now()) return existing;
    // Expired (or deleted in between): clear it and claim again.
    if (existing) await store.deleteById(claim.id).catch(() => undefined);
  }
  throw new Conflict(
    "A request with this Idempotency-Key is still being processed",
    undefined,
    undefined,
    "Retry with the same Idempotency-Key shortly.",
  );
}

function idempotencyKey(context: HookContext): string | undefined {
  const fromParams = context.params["idempotencyKey"];
  if (typeof fromParams === "string") return fromParams;
  const header = context.params.headers?.["idempotency-key"] as string | string[] | undefined;
  return Array.isArray(header) ? header[0] : header;
}

/** Agent, else user (record `id` or JWT `sub`), else a shared anonymous scope — plus the service path and method. */
function scopeOf(context: HookContext): string {
  const user = context.params.user;
  const userId = user?.["id"] ?? user?.["sub"];
  const principal = context.agent
    ? `agent:${context.agent.id}`
    : userId !== undefined
      ? `user:${String(userId)}`
      : "anonymous";
  return `${principal}\n${context.path}\n${context.method}`;
}

function recordIdFor(context: HookContext, key: string, idFormat: "hex" | "objectid"): string {
  const hex = sha256(`${scopeOf(context)}\n${key}`);
  return idFormat === "objectid" ? hex.slice(0, 24) : hex;
}

function fingerprintOf(context: HookContext): string {
  return sha256(canonicalJson([context.method, context.path, context.id ?? null, context.data ?? null]));
}

function stateOf(context: HookContext): CallState | undefined {
  return (context.params as Record<symbol, CallState | undefined>)[STATE];
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** JSON with object keys sorted, so `{ a, b }` and `{ b, a }` fingerprint the same. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, nested: unknown) =>
    nested !== null && typeof nested === "object" && !Array.isArray(nested)
      ? Object.fromEntries(
          Object.keys(nested)
            .sort()
            .map((key) => [key, (nested as Record<string, unknown>)[key]]),
        )
      : nested,
  );
}
