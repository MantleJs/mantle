import type { AgentContext, CapabilityScope, HookContext, HookFunction, Logger, Paginated, Repository } from "@mantlejs/mantle";
import { MantleError } from "@mantlejs/mantle";

/**
 * One audit entry: who did what, as which identity, with what result. Recorded by `auditLog()` to
 * whichever `Repository<T>` the deployment configures as the sink — audit records are themselves
 * a normal Mantle-shaped record, not a bespoke storage concept.
 */
export interface AuditRecord {
  /** `ctx.params.user` — undefined for an unauthenticated or internal call. */
  principal?: unknown;
  /** Set only when the call was authorized via an agent token (`HookContext.agent`, see `@mantlejs/auth`). */
  agentId?: string;
  /** The agent token's capability scope. Present only alongside `agentId`. */
  agentScope?: CapabilityScope;
  /** The user who minted the agent token. Present only alongside `agentId`. */
  delegatingUserId?: string;
  path: string;
  method: string;
  /**
   * The caller's query — `ctx.params.query` (filters, pagination, sort, select). Deliberately
   * never `ctx.params.headers` or the raw `ctx.params.user` object: those may carry bearer tokens
   * or other sensitive claims, and identity already has its own field (`principal`).
   */
  params?: Record<string, unknown>;
  status: "success" | "error";
  /** A short, non-exhaustive description of the outcome — never the full result payload. */
  resultSummary: string;
  /** ISO 8601 timestamp of when the entry was recorded. */
  timestamp: string;
  /** Index signature so `AuditRecord` satisfies `Repository<T extends Record<string, unknown>>` (e.g. `MemoryRepository`). */
  [key: string]: unknown;
}

export interface AuditLogOptions {
  /** Where audit records are written. Any `Repository<T>` the deployment already has — Postgres, Mongo, memory, whatever. */
  sink: Repository<AuditRecord>;
  /**
   * Called when the sink write itself throws. The primary operation always succeeds regardless —
   * a sink outage must never take down the service it's auditing. Defaults to logging via
   * `app.get<Logger>("logger")` when present (see `@mantlejs/logger`), otherwise silent.
   */
  onSinkError?: (error: unknown, record: AuditRecord, ctx: HookContext) => void;
}

/**
 * Returns a hook recording `{ principal, agentId?, path, method, params, resultSummary, timestamp
 * }` to `options.sink` on every call. Register the *same* returned function in `after.all` and
 * `error.all` — it fires exactly once per call, on whichever phase actually reaches it (a
 * successful call never reaches `error.all`; a thrown call never reaches `after.all`).
 *
 * ```typescript
 * app.service("documents").hooks({
 *   after: { all: [auditLog({ sink: auditRepository })] },
 *   error: { all: [auditLog({ sink: auditRepository })] },
 * });
 * ```
 *
 * A sink write failure is caught and never rethrown — see `AuditLogOptions.onSinkError`.
 */
export function auditLog(options: AuditLogOptions): HookFunction {
  return async function auditLogHook(ctx: HookContext): Promise<HookContext> {
    const record = buildRecord(ctx);
    try {
      await options.sink.save(record);
    } catch (error) {
      if (options.onSinkError) {
        options.onSinkError(error, record, ctx);
      } else {
        ctx.app.get<Logger | undefined>("logger")?.error("Audit sink write failed", {
          component: "mantle:audit",
          path: ctx.path,
          method: ctx.method,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return ctx;
  };
}

function buildRecord(ctx: HookContext): AuditRecord {
  const agent = ctx.agent as AgentContext | undefined;
  const { status, resultSummary } = summarize(ctx);

  return {
    principal: ctx.params.user,
    ...(agent ? { agentId: agent.id, agentScope: agent.scope, delegatingUserId: agent.delegatingUserId } : {}),
    path: ctx.path,
    method: ctx.method,
    ...(ctx.params.query ? { params: ctx.params.query as Record<string, unknown> } : {}),
    status,
    resultSummary,
    timestamp: new Date().toISOString(),
  };
}

function summarize(ctx: HookContext): { status: "success" | "error"; resultSummary: string } {
  if (ctx.error) {
    const name = ctx.error instanceof MantleError ? ctx.error.className : ctx.error.name;
    return { status: "error", resultSummary: `${name}: ${ctx.error.message}` };
  }

  const result = ctx.result;
  if (Array.isArray(result)) {
    return { status: "success", resultSummary: `${result.length} record(s)` };
  }
  if (isPaginated(result)) {
    return { status: "success", resultSummary: `${result.data.length} of ${result.total} record(s)` };
  }
  if (result !== null && typeof result === "object") {
    const id = (result as Record<string, unknown>)["id"];
    return { status: "success", resultSummary: id !== undefined ? `record id=${String(id)}` : "1 record" };
  }
  return { status: "success", resultSummary: "ok" };
}

function isPaginated(result: unknown): result is Paginated<unknown> {
  return (
    result !== null &&
    typeof result === "object" &&
    Array.isArray((result as Paginated<unknown>).data) &&
    typeof (result as Paginated<unknown>).total === "number"
  );
}
