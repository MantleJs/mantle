import type { HookContext, HookFunction, Id, Logger, Paginated, VectorRepository } from "@mantlejs/mantle";

/**
 * A pluggable embedding provider — the thing `embed()` calls to turn source text into a vector.
 * `@mantlejs/embeddings` never bundles a specific provider (OpenAI, Cohere, a local model, ...);
 * apps supply their own implementation, matching every vector adapter's own model-agnostic design.
 */
export interface EmbeddingProvider {
  /** Embedding dimensionality — informational, useful for validating a target index/collection. */
  dimensions?: number;
  embed(text: string): Promise<number[]>;
}

export interface EmbedOptions<T extends Record<string, unknown>> {
  /** The vector adapter to upsert the computed embedding into. */
  vectors: VectorRepository<T>;
  /** The embedding provider called with the extracted source text. */
  provider: EmbeddingProvider;
  /**
   * Source text to embed, derived from the just-written record (`ctx.result`): a single field
   * name, a list of field names (joined with `"\n"`), or a function for full control (e.g.
   * combining fields with custom formatting, or pulling in related data).
   */
  field: keyof T | Array<keyof T> | ((record: T) => string);
  /**
   * Called when extracting the text, calling the provider, or upserting the vector throws. The
   * primary write is never rolled back or blocked regardless — see the "Cross-adapter write
   * consistency" pattern in the root README. Defaults to logging via `app.get<Logger>("logger")`
   * when configured, otherwise silent.
   */
  onError?: (error: unknown, record: T, ctx: HookContext<T>) => void;
}

/**
 * Returns a hook that embeds the just-written record's text and upserts it into `options.vectors`
 * — the auto-embed-on-write hook. Attach to `after.create`/`after.update`/`after.patch` (never
 * `after.find`/`after.get`/`after.remove` — there is no freshly-written record to embed there):
 *
 * ```typescript
 * app.service("articles").hooks({
 *   after: {
 *     create: [embed({ vectors: articlesVectorRepo, provider: openaiEmbeddings(), field: ["title", "body"] })],
 *     update: [embed({ vectors: articlesVectorRepo, provider: openaiEmbeddings(), field: ["title", "body"] })],
 *     patch: [embed({ vectors: articlesVectorRepo, provider: openaiEmbeddings(), field: ["title", "body"] })],
 *   },
 * });
 * ```
 *
 * **Idempotent by construction:** `upsertVector(id, vector, data)` is an upsert keyed on the
 * source record's id — re-running this hook for the same id (a retry, or a second edit) replaces
 * the vector at that id rather than creating a duplicate, on every adapter (`@mantlejs/pinecone`,
 * `@mantlejs/qdrant`, `@mantlejs/mongodb`'s `MongoVectorRepository`, `@mantlejs/knex`'s
 * `KnexVectorRepository`). No extra bookkeeping is needed for that guarantee — it comes from the
 * adapter contract, not from this hook.
 *
 * **Non-fatal on failure:** an embedding-provider error or a vector-upsert error is caught here
 * and never rethrown — the primary write this hook runs after has already succeeded, and a
 * degraded/unavailable embedding provider must never turn that into a failed request.
 */
export function embed<T extends Record<string, unknown>>(options: EmbedOptions<T>): HookFunction<T> {
  return async function embedHook(ctx: HookContext<T>): Promise<HookContext<T>> {
    const record = singleRecord(ctx.result);
    if (!record) return ctx;

    const id = extractId(record, ctx.id);
    if (id === undefined) {
      reportError(new Error("embed(): the written record has no 'id' field to key the vector upsert on"), record, ctx, options);
      return ctx;
    }

    try {
      const text = extractText(options.field, record);
      const vector = await options.provider.embed(text);
      await options.vectors.upsertVector(id, vector, {});
    } catch (error) {
      reportError(error, record, ctx, options);
    }

    return ctx;
  };
}

/** Only a single freshly-written record is embeddable — never an array (find) or a paginated page. */
function singleRecord<T extends Record<string, unknown>>(result: T | T[] | Paginated<T> | undefined): T | undefined {
  if (result === undefined || Array.isArray(result) || isPaginated(result)) return undefined;
  return result;
}

function isPaginated(result: unknown): result is Paginated<unknown> {
  return (
    result !== null &&
    typeof result === "object" &&
    Array.isArray((result as Paginated<unknown>).data) &&
    typeof (result as Paginated<unknown>).total === "number"
  );
}

function extractId<T extends Record<string, unknown>>(record: T, ctxId: Id | undefined): Id | undefined {
  const recordId = record["id"];
  if (typeof recordId === "string" || typeof recordId === "number") return recordId;
  return ctxId;
}

function extractText<T extends Record<string, unknown>>(field: EmbedOptions<T>["field"], record: T): string {
  if (typeof field === "function") return field(record);
  const fields = Array.isArray(field) ? field : [field];
  return fields.map((f) => String(record[f as string] ?? "")).join("\n");
}

function reportError<T extends Record<string, unknown>>(
  error: unknown,
  record: T,
  ctx: HookContext<T>,
  options: EmbedOptions<T>,
): void {
  if (options.onError) {
    options.onError(error, record, ctx);
    return;
  }
  ctx.app.get<Logger | undefined>("logger")?.error("embed() failed", {
    component: "mantle:embeddings",
    path: ctx.path,
    method: ctx.method,
    error: error instanceof Error ? error.message : String(error),
  });
}
