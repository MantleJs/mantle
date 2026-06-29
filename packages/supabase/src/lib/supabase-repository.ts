import type { SupabaseClient, RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import type { Id, QueryParams, Repository } from "@mantlejs/mantle";
import { BadRequest, Conflict, Forbidden, GeneralError, NotFound } from "@mantlejs/mantle";
import type { MantleApplication } from "@mantlejs/mantle";

/** Internal type for the chainable PostgREST query builder returned by `client.from()`. */
type AnyQuery = Record<string, unknown>;

/** Supabase PostgREST response shape. */
interface PgResult<T = unknown> {
  data: T | null;
  error: PgError | null;
  count?: number | null;
}

interface PgError {
  code?: string;
  message?: string;
}

/**
 * Abstract base class for Supabase-backed repositories.
 *
 * Extend this class and set `tableName` to implement a Mantle `Repository<T>`
 * backed by a Supabase (PostgreSQL) table via the Supabase JS client.
 *
 * @example
 * ```ts
 * class UserRepository extends SupabaseRepository<User> {
 *   readonly tableName = "users";
 *
 *   async findByEmail(email: string): Promise<User | null> {
 *     const { data, error } = await this.db.select("*").eq("email", email).maybeSingle();
 *     if (error) throw this.wrapError(error);
 *     return data ?? null;
 *   }
 * }
 * ```
 */
export abstract class SupabaseRepository<T extends Record<string, unknown>, D = Partial<T>>
  implements Repository<T, D>
{
  protected readonly client: SupabaseClient;
  protected readonly app: MantleApplication;

  /** Supabase table name. */
  abstract readonly tableName: string;

  /**
   * The primary key column name.
   * @default "id"
   */
  readonly primaryKey: string = "id";

  /**
   * When true, `save` / `saveAll` / `updateById` / `patchById` automatically
   * write `created_at` and `updated_at` ISO-8601 timestamps.
   * @default true
   */
  readonly timestamps: boolean = true;

  /**
   * When true, subscribes to Postgres Changes for this table and re-emits
   * direct DB mutations (PostgREST, migrations, Supabase Studio) as Mantle
   * `service:event` emissions on the app event bus.
   * @default false
   */
  readonly listenToChanges: boolean = false;

  constructor(app: MantleApplication) {
    this.app = app;
    this.client = app.get<SupabaseClient>("supabase");
    // Defer until child class field initializers have run (JS class field initialization order).
    queueMicrotask(() => {
      if (this.listenToChanges) {
        this.setupPostgresChanges();
      }
    });
  }

  private setupPostgresChanges(): void {
    const channel = this.client
      .channel(`mantle:changes:${this.tableName}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: this.tableName },
        (payload: RealtimePostgresChangesPayload<T>) => {
          let mantleEvent: string;
          let record: T;

          switch (payload.eventType) {
            case "INSERT":
              mantleEvent = "created";
              record = payload.new as T;
              break;
            case "UPDATE":
              mantleEvent = "patched";
              record = payload.new as T;
              break;
            case "DELETE":
              mantleEvent = "removed";
              record = payload.old as T;
              break;
            default:
              return;
          }

          (this.app as unknown as { emit: (event: string, ...args: unknown[]) => void }).emit(
            "service:event",
            this.tableName,
            mantleEvent,
            record,
            {},
          );
        },
      )
      .subscribe();

    const teardown = (this.app as unknown as Record<string, unknown>)["teardown"] as (() => Promise<void>) | undefined;
    if (teardown) {
      (this.app as unknown as Record<string, unknown>)["teardown"] = async () => {
        await this.client.removeChannel(channel);
        await teardown.call(this.app);
      };
    }
  }

  // ─── Internal helpers ──────────────────────────────────────────────────────

  /**
   * Returns a query builder scoped to this repository's table.
   * Useful for writing custom queries in subclasses.
   */
  protected get db(): AnyQuery {
    return this.client.from(this.tableName) as unknown as AnyQuery;
  }

  private withTimestamps(
    data: Record<string, unknown>,
    op: "create" | "update",
    now = new Date(),
  ): Record<string, unknown> {
    if (!this.timestamps) return data;
    return op === "create"
      ? { ...data, created_at: now.toISOString(), updated_at: now.toISOString() }
      : { ...data, updated_at: now.toISOString() };
  }

  private chain(query: AnyQuery, method: string, ...args: unknown[]): AnyQuery {
    return (query[method] as (...a: unknown[]) => AnyQuery)(...args);
  }

  /**
   * Apply `QueryParams` filters, sorting, and pagination to a query builder.
   * Subclasses may call this to re-use the standard filter logic in custom queries.
   */
  protected applyParams(query: AnyQuery, params?: QueryParams): AnyQuery {
    if (params?.where) {
      query = this.applyWhere(query, params.where);
    }
    if (params?.sort) {
      for (const [col, dir] of Object.entries(params.sort)) {
        query = this.chain(query, "order", col, { ascending: dir === "asc" });
      }
    }
    if (params?.limit !== undefined) {
      const from = params.skip ?? 0;
      query = this.chain(query, "range", from, from + params.limit - 1);
    } else if (params?.skip) {
      query = this.chain(query, "range", params.skip, 2_147_483_647);
    }
    return query;
  }

  private applyWhere(query: AnyQuery, where: Record<string, unknown>): AnyQuery {
    for (const [key, value] of Object.entries(where)) {
      if (key === "$or" && Array.isArray(value)) {
        const parts = (value as Record<string, unknown>[]).map((clause) => this.buildOrPart(clause));
        query = this.chain(query, "or", parts.join(","));
        continue;
      }
      if (key === "$and" && Array.isArray(value)) {
        for (const clause of value as Record<string, unknown>[]) {
          query = this.applyWhere(query, clause);
        }
        continue;
      }

      if (value === null) {
        query = this.chain(query, "is", key, null);
      } else if (typeof value === "object" && !Array.isArray(value)) {
        const ops = value as Record<string, unknown>;
        for (const [op, opVal] of Object.entries(ops)) {
          query = this.applyOperator(query, key, op, opVal);
        }
      } else {
        query = this.chain(query, "eq", key, value);
      }
    }
    return query;
  }

  private applyOperator(query: AnyQuery, col: string, op: string, val: unknown): AnyQuery {
    switch (op) {
      case "$lt":
        return this.chain(query, "lt", col, val);
      case "$lte":
        return this.chain(query, "lte", col, val);
      case "$gt":
        return this.chain(query, "gt", col, val);
      case "$gte":
        return this.chain(query, "gte", col, val);
      case "$ne":
        if (val === null) return this.chain(query, "not", col, "is", null);
        return this.chain(query, "neq", col, val);
      case "$in":
        return this.chain(query, "in", col, val);
      case "$nin":
        return this.chain(query, "not", col, "in", `(${(val as unknown[]).join(",")})`);
      case "$like":
        return this.chain(query, "like", col, val);
      case "$ilike":
        return this.chain(query, "ilike", col, val);
      case "$notlike":
        return this.chain(query, "not", col, "like", val);
      default:
        throw new BadRequest(`Unsupported query operator: ${op}`);
    }
  }

  private buildOrPart(clause: Record<string, unknown>): string {
    const parts: string[] = [];
    for (const [col, value] of Object.entries(clause)) {
      if (value === null) {
        parts.push(`${col}.is.null`);
      } else if (typeof value === "object" && !Array.isArray(value)) {
        for (const [op, opVal] of Object.entries(value as Record<string, unknown>)) {
          const pgOp = this.opToPg(op);
          parts.push(`${col}.${pgOp}.${String(opVal)}`);
        }
      } else {
        parts.push(`${col}.eq.${String(value)}`);
      }
    }
    return parts.join(",");
  }

  private opToPg(op: string): string {
    const map: Record<string, string> = {
      $lt: "lt",
      $lte: "lte",
      $gt: "gt",
      $gte: "gte",
      $ne: "neq",
      $in: "in",
      $like: "like",
      $ilike: "ilike",
    };
    return map[op] ?? op;
  }

  // ─── Repository implementation ─────────────────────────────────────────────

  async findAll(params?: QueryParams): Promise<T[]> {
    try {
      let query = this.chain(this.db, "select", "*");
      if (params?.select && params.select.length > 0) {
        query = this.chain(this.db, "select", params.select.join(", "));
      }
      query = this.applyParams(query, params);
      const { data, error } = (await (query as unknown as Promise<PgResult<T[]>>));
      if (error) throw this.wrapError(error);
      return data ?? [];
    } catch (err) {
      if (this.isMantleError(err)) throw err;
      throw this.wrapError(err);
    }
  }

  async findById(id: Id): Promise<T | null> {
    try {
      let query = this.chain(this.db, "select", "*");
      query = this.chain(query, "eq", this.primaryKey, String(id));
      query = this.chain(query, "maybeSingle");
      const { data, error } = (await (query as unknown as Promise<PgResult<T>>));
      if (error) throw this.wrapError(error);
      return (data as T) ?? null;
    } catch (err) {
      if (this.isMantleError(err)) throw err;
      throw this.wrapError(err);
    }
  }

  async save(data: D): Promise<T> {
    try {
      const payload = this.withTimestamps(data as Record<string, unknown>, "create");
      let query = this.chain(this.db, "insert", payload);
      query = this.chain(query, "select");
      query = this.chain(query, "single");
      const { data: row, error } = (await (query as unknown as Promise<PgResult<T>>));
      if (error) throw this.wrapError(error);
      return row as T;
    } catch (err) {
      if (this.isMantleError(err)) throw err;
      throw this.wrapError(err);
    }
  }

  async saveAll(data: D[]): Promise<T[]> {
    try {
      const now = new Date();
      const payloads = data.map((d) => this.withTimestamps(d as Record<string, unknown>, "create", now));
      let query = this.chain(this.db, "insert", payloads);
      query = this.chain(query, "select");
      const { data: rows, error } = (await (query as unknown as Promise<PgResult<T[]>>));
      if (error) throw this.wrapError(error);
      return (rows as T[]) ?? [];
    } catch (err) {
      if (this.isMantleError(err)) throw err;
      throw this.wrapError(err);
    }
  }

  async updateById(id: Id, data: D): Promise<T> {
    try {
      const existing = await this.findById(id);
      if (!existing) throw new NotFound(`No row found with ${this.primaryKey} = ${String(id)}`);

      const payload = this.withTimestamps(data as Record<string, unknown>, "update");
      let query = this.chain(this.db, "update", payload);
      query = this.chain(query, "eq", this.primaryKey, String(id));
      query = this.chain(query, "select");
      query = this.chain(query, "single");
      const { data: row, error } = (await (query as unknown as Promise<PgResult<T>>));
      if (error) throw this.wrapError(error);
      return row as T;
    } catch (err) {
      if (this.isMantleError(err)) throw err;
      throw this.wrapError(err);
    }
  }

  async patchById(id: Id, data: D): Promise<T> {
    try {
      const filtered = Object.fromEntries(
        Object.entries(data as Record<string, unknown>).filter(([, v]) => v !== undefined),
      );
      const payload = this.withTimestamps(filtered, "update");
      let query = this.chain(this.db, "update", payload);
      query = this.chain(query, "eq", this.primaryKey, String(id));
      query = this.chain(query, "select");
      query = this.chain(query, "single");
      const { data: row, error } = (await (query as unknown as Promise<PgResult<T>>));
      if (error) {
        if ((error as PgError).code === "PGRST116") {
          throw new NotFound(`No row found with ${this.primaryKey} = ${String(id)}`);
        }
        throw this.wrapError(error);
      }
      return row as T;
    } catch (err) {
      if (this.isMantleError(err)) throw err;
      throw this.wrapError(err);
    }
  }

  async deleteById(id: Id): Promise<T> {
    try {
      let query = this.chain(this.db, "delete");
      query = this.chain(query, "eq", this.primaryKey, String(id));
      query = this.chain(query, "select");
      query = this.chain(query, "single");
      const { data: row, error } = (await (query as unknown as Promise<PgResult<T>>));
      if (error) {
        if ((error as PgError).code === "PGRST116") {
          throw new NotFound(`No row found with ${this.primaryKey} = ${String(id)}`);
        }
        throw this.wrapError(error);
      }
      if (!row) throw new NotFound(`No row found with ${this.primaryKey} = ${String(id)}`);
      return row as T;
    } catch (err) {
      if (this.isMantleError(err)) throw err;
      throw this.wrapError(err);
    }
  }

  async count(params?: QueryParams): Promise<number> {
    try {
      let query = this.chain(this.db, "select", "*", { count: "exact", head: true });
      if (params?.where) {
        query = this.applyWhere(query, params.where);
      }
      const { count, error } = (await (query as unknown as Promise<PgResult<never> & { count: number | null }>));
      if (error) throw this.wrapError(error);
      return count ?? 0;
    } catch (err) {
      if (this.isMantleError(err)) throw err;
      throw this.wrapError(err);
    }
  }

  // ─── Error handling ────────────────────────────────────────────────────────

  private isMantleError(err: unknown): err is Error {
    return (
      err instanceof NotFound ||
      err instanceof Conflict ||
      err instanceof BadRequest ||
      err instanceof Forbidden ||
      err instanceof GeneralError
    );
  }

  protected wrapError(err: unknown): Error {
    const code = (err as PgError).code ?? "";
    const message = (err as { message?: string }).message ?? String(err);

    // PostgreSQL error codes: https://www.postgresql.org/docs/current/errcodes-appendix.html
    // Supabase PostgREST codes: https://postgrest.org/en/stable/references/errors.html
    switch (code) {
      case "PGRST116":
        return new NotFound(message);
      case "23505":
        return new Conflict(message);
      case "23503":
      case "23514":
      case "23502":
        return new BadRequest(message);
      case "42501":
      case "28000":
      case "28P01":
        return new Forbidden(message);
      default:
        return new GeneralError(message);
    }
  }
}
