import type { Knex } from "knex";
import type { Id, QueryParams, Repository } from "@mantlejs/mantle";
import {
  BadRequest,
  Conflict,
  Forbidden,
  GeneralError,
  NotFound,
  Unavailable,
  Unprocessable,
} from "@mantlejs/mantle";
import type { MantleApplication } from "@mantlejs/mantle";
import { knexify } from "./knexify.js";
import type { WhereClause } from "./knexify.js";

export abstract class KnexRepository<T extends Record<string, unknown>, D = Partial<T>> implements Repository<T, D> {
  protected readonly knex: Knex;
  protected _trx: Knex.Transaction | null = null;

  abstract readonly tableName: string;
  readonly idField: string = "id";
  readonly timestamps: boolean = true;

  constructor(app: MantleApplication) {
    this.knex = app.get<Knex>("knex");
  }

  /** Raw query builder for this table, respecting any active transaction. */
  get db(): Knex.QueryBuilder {
    return this.qb(this.tableName);
  }

  /**
   * Run a set of repository operations inside a single database transaction.
   * The callback receives a transaction-scoped copy of this repository.
   */
  async withTransaction<R>(callback: (repo: this) => Promise<R>): Promise<R> {
    return this.knex.transaction(async (trx) => {
      const copy = Object.create(this) as this;
      copy._trx = trx;
      return callback(copy);
    });
  }

  // ─── Internal helpers ─────────────────────────────────────────────────────

  protected get qb(): Knex | Knex.Transaction {
    return this._trx ?? this.knex;
  }

  private get supportsReturning(): boolean {
    const client = (this.knex.client as unknown as { config?: { client?: string } }).config?.client ?? "";
    return ["pg", "postgresql", "sqlite3", "mssql", "oracledb"].some((c) => client.startsWith(c));
  }

  protected buildQuery(params?: QueryParams): Knex.QueryBuilder {
    let query: Knex.QueryBuilder = this.qb(this.tableName);
    if (params?.where) {
      query = knexify(query, params.where as WhereClause);
    }
    if (params?.sort) {
      for (const [col, dir] of Object.entries(params.sort)) {
        query = query.orderBy(col, dir);
      }
    }
    if (params?.skip != null) {
      query = query.offset(params.skip);
    }
    if (params?.limit != null) {
      query = query.limit(params.limit);
    }
    return query;
  }

  private withTimestamps(
    data: Record<string, unknown>,
    op: "create" | "update",
    now = new Date(),
  ): Record<string, unknown> {
    if (!this.timestamps) return data;
    return op === "create" ? { ...data, createdAt: now, updatedAt: now } : { ...data, updatedAt: now };
  }

  // ─── Repository implementation ────────────────────────────────────────────

  async findAll(params?: QueryParams): Promise<T[]> {
    try {
      const query = this.buildQuery(params);
      const rows = params?.select ? await query.select(params.select) : await query.select("*");
      return rows as T[];
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async findById(id: Id): Promise<T | null> {
    try {
      const row = await this.qb(this.tableName).where({ [this.idField]: id }).first();
      return (row as T) ?? null;
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async save(data: D): Promise<T> {
    try {
      const payload = this.withTimestamps(data as Record<string, unknown>, "create");
      if (this.supportsReturning) {
        const [row] = await this.qb(this.tableName).insert(payload).returning("*");
        return row as T;
      }
      const [id] = await this.qb(this.tableName).insert(payload);
      const row = await this.qb(this.tableName).where({ [this.idField]: id as Id }).first();
      return row as T;
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async saveAll(data: D[]): Promise<T[]> {
    try {
      const now = new Date();
      const payload = data.map((d) => this.withTimestamps(d as Record<string, unknown>, "create", now));
      if (this.supportsReturning) {
        const rows = await this.qb(this.tableName).insert(payload).returning("*");
        return rows as T[];
      }
      // MySQL/MariaDB: insert rows individually to get each inserted id
      const results = await Promise.all(
        payload.map(async (row) => {
          const [id] = await this.qb(this.tableName).insert(row);
          return this.qb(this.tableName).where({ [this.idField]: id as Id }).first();
        }),
      );
      return results as T[];
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async updateById(id: Id, data: D): Promise<T> {
    try {
      const payload = this.withTimestamps(data as Record<string, unknown>, "update");
      if (this.supportsReturning) {
        const [row] = await this.qb(this.tableName)
          .where({ [this.idField]: id })
          .update(payload)
          .returning("*");
        if (!row) throw new NotFound(`No record found with ${this.idField} = ${id}`);
        return row as T;
      }
      const count = await this.qb(this.tableName).where({ [this.idField]: id }).update(payload);
      if (count === 0) throw new NotFound(`No record found with ${this.idField} = ${id}`);
      const row = await this.qb(this.tableName).where({ [this.idField]: id }).first();
      return row as T;
    } catch (err) {
      if (err instanceof NotFound) throw err;
      throw this.wrapError(err);
    }
  }

  async patchById(id: Id, data: D): Promise<T> {
    try {
      const filtered = Object.fromEntries(
        Object.entries(data as Record<string, unknown>).filter(([, v]) => v !== undefined),
      );
      const payload = this.withTimestamps(filtered, "update");
      if (this.supportsReturning) {
        const [row] = await this.qb(this.tableName)
          .where({ [this.idField]: id })
          .update(payload)
          .returning("*");
        if (!row) throw new NotFound(`No record found with ${this.idField} = ${id}`);
        return row as T;
      }
      const count = await this.qb(this.tableName).where({ [this.idField]: id }).update(payload);
      if (count === 0) throw new NotFound(`No record found with ${this.idField} = ${id}`);
      const row = await this.qb(this.tableName).where({ [this.idField]: id }).first();
      return row as T;
    } catch (err) {
      if (err instanceof NotFound) throw err;
      throw this.wrapError(err);
    }
  }

  async deleteById(id: Id): Promise<T> {
    try {
      if (this.supportsReturning) {
        const [row] = await this.qb(this.tableName)
          .where({ [this.idField]: id })
          .delete()
          .returning("*");
        if (!row) throw new NotFound(`No record found with ${this.idField} = ${id}`);
        return row as T;
      }
      const row = await this.qb(this.tableName).where({ [this.idField]: id }).first();
      if (!row) throw new NotFound(`No record found with ${this.idField} = ${id}`);
      await this.qb(this.tableName).where({ [this.idField]: id }).delete();
      return row as T;
    } catch (err) {
      if (err instanceof NotFound) throw err;
      throw this.wrapError(err);
    }
  }

  async count(params?: QueryParams): Promise<number> {
    try {
      let query: Knex.QueryBuilder = this.qb(this.tableName);
      if (params?.where) {
        query = knexify(query, params.where as WhereClause);
      }
      const results = (await query.count({ count: "*" })) as Array<{ count: string }>;
      return Number(results[0]?.count ?? 0);
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  protected wrapError(err: unknown): Error {
    if (!(err instanceof Error)) return new GeneralError("An unknown database error occurred");
    const code = (err as { code?: string }).code ?? "";
    const prefix = code.slice(0, 2);
    switch (prefix) {
      case "08": // Connection errors
      case "57": // Operator intervention (PostgreSQL)
        return new Unavailable(err.message);
      case "22": // Data exception
        return new BadRequest(err.message);
      case "23": // Integrity constraint violation
        return code === "23505" ? new Conflict(err.message) : new BadRequest(err.message);
      case "28": // Invalid authorization specification
        return new Forbidden(err.message);
      case "3D": // Invalid catalog name
      case "3F": // Invalid schema name
      case "42": // Syntax error or access rule violation
        return new Unprocessable(err.message);
      default:
        return new GeneralError(err.message);
    }
  }
}
