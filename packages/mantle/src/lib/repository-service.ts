import type { Id, Paginated, QueryParams, Repository, Service, ServiceParams } from "./types.js";
import { BadRequest, NotFound } from "./errors.js";

export interface RepositoryServiceOptions {
  /**
   * Duck-typed JSON-Schema-ish object: `{ properties: { field: { type: "number" } } }`.
   * Used only to coerce query-string values to their field types. A TypeBox entity
   * schema satisfies this shape — but this is structural on purpose: @mantlejs/mantle
   * depends on nothing.
   */
  schema?: { properties?: Record<string, { type?: string }> };
  /** Whitelist of queryable fields. When set, a where/sort/select key outside it throws BadRequest. */
  fields?: string[];
  /** Pagination defaults. When set, find() applies `default` and caps `$limit` at `max`. */
  paginate?: { default: number; max: number };
}

const RESERVED_KEYS = new Set(["$limit", "$skip", "$sort", "$select"]);

interface ParsedQuery {
  where: Record<string, unknown>;
  limit?: number;
  skip?: number;
  sort?: Record<string, "asc" | "desc">;
  select?: string[];
}

/**
 * A concrete `Service<T>` over any `Repository<T>` — the framework-owned bridge from
 * `ServiceParams.query` (raw strings from HTTP) to `QueryParams`.
 *
 * Query conventions (see the Phase 4 TDD, section 14):
 * - Reserved keys inside `query`: `$limit`, `$skip`, `$sort`, `$select`; everything else is `where`.
 * - `find()` ALWAYS returns `Paginated<T>` — `total` via `repository.count({ where })`.
 * - With `options.fields`, unknown where/sort/select fields throw `BadRequest`.
 * - With `options.schema`, string where-values are coerced to the field's declared type;
 *   without one they pass through unchanged.
 * - `update`/`patch`/`remove` propagate the repository's `NotFound` untouched.
 */
export class RepositoryService<T, D = Partial<T>> implements Service<T, D> {
  constructor(
    protected readonly repository: Repository<T, D>,
    protected readonly options: RepositoryServiceOptions = {},
  ) {}

  async find(params?: ServiceParams): Promise<Paginated<T>> {
    const { where, limit, skip, sort, select } = this.parseQuery(params?.query ?? {});

    let effectiveLimit = limit;
    if (this.options.paginate) {
      effectiveLimit =
        limit === undefined ? this.options.paginate.default : Math.min(limit, this.options.paginate.max);
    }

    const queryParams: QueryParams = {
      ...(Object.keys(where).length > 0 ? { where } : {}),
      ...(effectiveLimit !== undefined ? { limit: effectiveLimit } : {}),
      ...(skip !== undefined ? { skip } : {}),
      ...(sort !== undefined ? { sort } : {}),
      ...(select !== undefined ? { select } : {}),
    };

    const [data, total] = await Promise.all([
      this.repository.findAll(queryParams),
      this.repository.count(Object.keys(where).length > 0 ? { where } : {}),
    ]);

    return { total, limit: effectiveLimit ?? total, skip: skip ?? 0, data };
  }

  async get(id: Id, _params?: ServiceParams): Promise<T> {
    const record = await this.repository.findById(id);
    if (record === null) {
      throw new NotFound(`No record found for id '${String(id)}'`);
    }
    return record;
  }

  async create(data: D, _params?: ServiceParams): Promise<T>;
  async create(data: D[], _params?: ServiceParams): Promise<T[]>;
  async create(data: D | D[], _params?: ServiceParams): Promise<T | T[]> {
    if (Array.isArray(data)) {
      return this.repository.saveAll(data);
    }
    return this.repository.save(data);
  }

  async update(id: Id, data: D, _params?: ServiceParams): Promise<T> {
    return this.repository.updateById(id, data);
  }

  async patch(id: Id, data: D, _params?: ServiceParams): Promise<T> {
    return this.repository.patchById(id, data);
  }

  async remove(id: Id, _params?: ServiceParams): Promise<T> {
    return this.repository.deleteById(id);
  }

  // ─── Query translation ─────────────────────────────────────────────────────

  protected parseQuery(query: Record<string, unknown>): ParsedQuery {
    const where: Record<string, unknown> = {};
    const parsed: ParsedQuery = { where };

    for (const [key, value] of Object.entries(query)) {
      if (!RESERVED_KEYS.has(key)) {
        where[key] = value;
        continue;
      }
      if (key === "$limit") parsed.limit = this.toNonNegativeInt("$limit", value);
      if (key === "$skip") parsed.skip = this.toNonNegativeInt("$skip", value);
      if (key === "$sort") parsed.sort = this.toSort(value);
      if (key === "$select") parsed.select = this.toSelect(value);
    }

    this.assertFields(where);
    parsed.where = this.coerceWhere(where);
    return parsed;
  }

  private toNonNegativeInt(key: string, value: unknown): number {
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isInteger(n) || n < 0) {
      throw new BadRequest(`${key} must be a non-negative integer, got '${String(value)}'`);
    }
    return n;
  }

  private toSort(value: unknown): Record<string, "asc" | "desc"> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new BadRequest("$sort must be an object of field: asc|desc pairs");
    }
    const sort: Record<string, "asc" | "desc"> = {};
    for (const [field, dir] of Object.entries(value as Record<string, unknown>)) {
      this.assertField(field);
      const d = String(dir);
      if (d === "asc" || d === "1") sort[field] = "asc";
      else if (d === "desc" || d === "-1") sort[field] = "desc";
      else throw new BadRequest(`$sort direction for '${field}' must be asc, desc, 1, or -1, got '${d}'`);
    }
    return sort;
  }

  private toSelect(value: unknown): string[] {
    const fields = Array.isArray(value) ? value : [value];
    return fields.map((f) => {
      if (typeof f !== "string") {
        throw new BadRequest("$select must be a field name or an array of field names");
      }
      this.assertField(f);
      return f;
    });
  }

  // ─── Field whitelist ───────────────────────────────────────────────────────

  private assertField(field: string): void {
    const allowed = this.options.fields;
    if (allowed && !allowed.includes(field)) {
      throw new BadRequest(`Field '${field}' is not queryable. Allowed: ${allowed.join(", ")}`);
    }
  }

  private assertFields(where: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(where)) {
      if (key === "$or" || key === "$and") {
        if (Array.isArray(value)) {
          for (const clause of value) {
            if (clause !== null && typeof clause === "object" && !Array.isArray(clause)) {
              this.assertFields(clause as Record<string, unknown>);
            }
          }
        }
        continue;
      }
      this.assertField(key);
    }
  }

  // ─── Schema-driven string coercion ─────────────────────────────────────────

  private coerceWhere(where: Record<string, unknown>): Record<string, unknown> {
    if (!this.options.schema?.properties) return where;

    const coerced: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(where)) {
      if (key === "$or" || key === "$and") {
        coerced[key] = Array.isArray(value)
          ? value.map((clause) =>
              clause !== null && typeof clause === "object" && !Array.isArray(clause)
                ? this.coerceWhere(clause as Record<string, unknown>)
                : clause,
            )
          : value;
        continue;
      }

      const type = this.options.schema.properties[key]?.type;
      if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        const ops: Record<string, unknown> = {};
        for (const [op, opVal] of Object.entries(value as Record<string, unknown>)) {
          ops[op] = Array.isArray(opVal)
            ? opVal.map((v) => this.coerceValue(key, type, v))
            : this.coerceValue(key, type, opVal);
        }
        coerced[key] = ops;
      } else if (Array.isArray(value)) {
        coerced[key] = value.map((v) => this.coerceValue(key, type, v));
      } else {
        coerced[key] = this.coerceValue(key, type, value);
      }
    }
    return coerced;
  }

  private coerceValue(field: string, type: string | undefined, value: unknown): unknown {
    if (typeof value !== "string" || type === undefined) return value;
    if (type === "number" || type === "integer") {
      const n = Number(value);
      if (Number.isNaN(n)) {
        throw new BadRequest(`Field '${field}' expects a ${type}, got '${value}'`);
      }
      return n;
    }
    if (type === "boolean") {
      if (value === "true") return true;
      if (value === "false") return false;
      throw new BadRequest(`Field '${field}' expects a boolean, got '${value}'`);
    }
    return value;
  }
}
