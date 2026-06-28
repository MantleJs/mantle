import type { Id, QueryParams, Repository } from "@mantlejs/mantle";
import { NotFound } from "@mantlejs/mantle";

export interface MemoryRepositoryOptions {
  /** Primary key field name. Default: 'id' */
  idField?: string;
  /** Auto-generate string UUIDs for new records. Default: true */
  autoId?: boolean;
  /** Auto-manage createdAt / updatedAt timestamps. Default: true */
  timestamps?: boolean;
}

type Primitive = string | number | boolean | null;
type WhereClause = Record<string, unknown>;

export class MemoryRepository<T extends Record<string, unknown>> implements Repository<T, Partial<T>> {
  private readonly _store = new Map<Id, T>();
  private readonly idField: string;
  private readonly autoId: boolean;
  private readonly timestamps: boolean;

  constructor(options: MemoryRepositoryOptions = {}) {
    this.idField = options.idField ?? "id";
    this.autoId = options.autoId ?? true;
    this.timestamps = options.timestamps ?? true;
  }

  get store(): ReadonlyMap<Id, T> {
    return this._store;
  }

  seed(records: T[]): this {
    for (const record of records) {
      const id = record[this.idField] as Id;
      this._store.set(id, { ...record });
    }
    return this;
  }

  clear(): this {
    this._store.clear();
    return this;
  }

  async findAll(params?: QueryParams): Promise<T[]> {
    let results = Array.from(this._store.values());

    if (params?.where) {
      const where = params.where;
      results = results.filter((record) => matchesWhere(record, where));
    }

    if (params?.sort) {
      results = applySort(results, params.sort);
    }

    if (params?.skip) {
      results = results.slice(params.skip);
    }

    if (params?.limit !== undefined) {
      results = results.slice(0, params.limit);
    }

    if (params?.select) {
      const select = params.select;
      results = results.map((r) => selectFields(r, select));
    }

    return results;
  }

  async findById(id: Id): Promise<T | null> {
    return this._store.get(id) ?? null;
  }

  async save(data: Partial<T>): Promise<T> {
    const id: Id =
      this.autoId && data[this.idField] === undefined
        ? crypto.randomUUID()
        : (data[this.idField] as Id);

    const now = new Date().toISOString();
    const record = {
      ...data,
      [this.idField]: id,
      ...(this.timestamps ? { createdAt: now, updatedAt: now } : {}),
    } as T;

    this._store.set(id, record);
    return record;
  }

  async saveAll(data: Partial<T>[]): Promise<T[]> {
    return Promise.all(data.map((d) => this.save(d)));
  }

  async updateById(id: Id, data: Partial<T>): Promise<T> {
    if (!this._store.has(id)) {
      throw new NotFound(`Record with id ${id} not found`);
    }
    const existing = this._store.get(id) as T;
    const now = new Date().toISOString();
    const record = {
      ...data,
      [this.idField]: id,
      ...(this.timestamps ? { createdAt: (existing as Record<string, unknown>).createdAt, updatedAt: now } : {}),
    } as T;

    this._store.set(id, record);
    return record;
  }

  async patchById(id: Id, data: Partial<T>): Promise<T> {
    if (!this._store.has(id)) {
      throw new NotFound(`Record with id ${id} not found`);
    }
    const existing = this._store.get(id) as T;
    const now = new Date().toISOString();
    const record = {
      ...existing,
      ...data,
      [this.idField]: id,
      ...(this.timestamps ? { updatedAt: now } : {}),
    } as T;

    this._store.set(id, record);
    return record;
  }

  async deleteById(id: Id): Promise<T> {
    const record = this._store.get(id);
    if (!record) {
      throw new NotFound(`Record with id ${id} not found`);
    }
    this._store.delete(id);
    return record;
  }

  async count(params?: QueryParams): Promise<number> {
    if (!params?.where) {
      return this._store.size;
    }
    let count = 0;
    for (const record of this._store.values()) {
      if (matchesWhere(record, params.where)) count++;
    }
    return count;
  }
}

function matchesWhere(record: Record<string, unknown>, where: WhereClause): boolean {
  for (const [key, value] of Object.entries(where)) {
    if (key === "$or") {
      const conditions = value as WhereClause[];
      if (!conditions.some((c) => matchesWhere(record, c))) return false;
    } else if (key === "$and") {
      const conditions = value as WhereClause[];
      if (!conditions.every((c) => matchesWhere(record, c))) return false;
    } else if (value === null) {
      if (record[key] !== null && record[key] !== undefined) return false;
    } else if (Array.isArray(value)) {
      if (!(value as Primitive[]).includes(record[key] as Primitive)) return false;
    } else if (typeof value === "object") {
      if (!matchesOperators(record[key], value as Record<string, unknown>)) return false;
    } else {
      if (record[key] !== value) return false;
    }
  }
  return true;
}

function matchesOperators(fieldValue: unknown, ops: Record<string, unknown>): boolean {
  for (const [op, operand] of Object.entries(ops)) {
    switch (op) {
      case "$lt":
        if (!((fieldValue as number) < (operand as number))) return false;
        break;
      case "$lte":
        if (!((fieldValue as number) <= (operand as number))) return false;
        break;
      case "$gt":
        if (!((fieldValue as number) > (operand as number))) return false;
        break;
      case "$gte":
        if (!((fieldValue as number) >= (operand as number))) return false;
        break;
      case "$ne":
        if (operand === null) {
          if (fieldValue === null || fieldValue === undefined) return false;
        } else {
          if (fieldValue === operand) return false;
        }
        break;
      case "$in":
        if (!(operand as Primitive[]).includes(fieldValue as Primitive)) return false;
        break;
      case "$nin":
        if ((operand as Primitive[]).includes(fieldValue as Primitive)) return false;
        break;
      case "$like":
        if (!likeMatch(fieldValue as string, operand as string, false)) return false;
        break;
      case "$notlike":
        if (likeMatch(fieldValue as string, operand as string, false)) return false;
        break;
      case "$ilike":
        if (!likeMatch(fieldValue as string, operand as string, true)) return false;
        break;
      default:
        if (fieldValue !== operand) return false;
    }
  }
  return true;
}

function likeMatch(value: string, pattern: string, caseInsensitive: boolean): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".");
  const flags = caseInsensitive ? "i" : "";
  return new RegExp(`^${escaped}$`, flags).test(value);
}

function applySort<T extends Record<string, unknown>>(records: T[], sort: Record<string, "asc" | "desc">): T[] {
  return [...records].sort((a, b) => {
    for (const [field, dir] of Object.entries(sort)) {
      const av = a[field];
      const bv = b[field];
      if (av === bv) continue;
      const cmp = (av as string | number) < (bv as string | number) ? -1 : 1;
      return dir === "asc" ? cmp : -cmp;
    }
    return 0;
  });
}

function selectFields<T extends Record<string, unknown>>(record: T, fields: string[]): T {
  const result: Record<string, unknown> = {};
  for (const f of fields) {
    result[f] = record[f];
  }
  return result as T;
}
