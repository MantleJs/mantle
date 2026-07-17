import { Pinecone, Index } from "@pinecone-database/pinecone";
import type { RecordMetadata } from "@pinecone-database/pinecone";
import type { CursorPage, Id, QueryParams, RepositoryCapabilities, VectorRepository } from "@mantlejs/mantle";
import { BadRequest, GeneralError, MantleError, NotFound } from "@mantlejs/mantle";
import type { MantleApplication } from "@mantlejs/mantle";
import { toPineconeFilter, PINECONE_OPERATORS } from "./pinecone-filter.js";
import type { WhereClause } from "./pinecone-filter.js";

const FETCH_BATCH_SIZE = 1000;
const LIST_PAGE_SIZE = 100;

/**
 * A Mantle `VectorRepository<T>` implementation backed by a Pinecone vector index.
 *
 * Records are stored as Pinecone vectors. The `idField` value is the Pinecone record ID;
 * all other fields are stored in the vector metadata. Call `upsertVector` to attach a real
 * embedding — `save` / `saveAll` insert a zero vector placeholder that is later replaced.
 *
 * @template T  The entity shape. Must extend `Record<string, unknown>`.
 * @template D  The write shape (defaults to `Partial<T>`).
 */
export abstract class PineconeRepository<T extends Record<string, unknown>, D = Partial<T>>
  implements VectorRepository<T, D>
{
  protected readonly client: Pinecone;

  /** The Pinecone index name to target. */
  abstract readonly indexName: string;
  /** The namespace within the index. */
  abstract readonly namespace: string;
  /** The number of dimensions in the index — required for zero-vector placeholders. */
  abstract readonly vectorDimension: number;

  /** The metadata key that holds the record id. @default "id" */
  readonly idField: string = "id";
  /** When true, `save` / `saveAll` / `updateById` / `patchById` write ISO-8601 timestamps. @default true */
  readonly timestamps: boolean = true;

  private _index?: Index;

  constructor(app: MantleApplication) {
    this.client = app.get<Pinecone>("pinecone");
  }

  /** Lazily resolved namespace-scoped Pinecone Index instance. */
  protected get index(): Index {
    if (!this._index) {
      this._index = this.client.index({ name: this.indexName, namespace: this.namespace });
    }
    return this._index;
  }

  describe(): RepositoryCapabilities {
    return {
      adapter: "@mantlejs/pinecone",
      operators: [...PINECONE_OPERATORS],
      pagination: "both",
      fullTextSearch: false,
    };
  }

  // ─── VectorRepository methods ─────────────────────────────────────────────

  /** Every result carries the Pinecone match score as `_score` — HIGHER is more similar. */
  async findSimilar(vector: number[], topK: number, params?: QueryParams): Promise<Array<T & { _score: number }>> {
    try {
      const response = await this.index.query({
        vector,
        topK,
        includeMetadata: true,
        ...(params?.where ? { filter: toPineconeFilter(params.where as WhereClause) } : {}),
      });
      return (response.matches ?? []).map((m) => ({
        ...this.fromRecord(m.id, (m.metadata ?? {}) as Record<string, unknown>),
        _score: m.score ?? 0,
      }));
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async upsertVector(id: Id, vector: number[], data: Partial<T>): Promise<T> {
    try {
      const metadata = this.toMetadata(data as Record<string, unknown>);
      await this.index.upsert({ records: [{ id: String(id), values: vector, metadata }] });
      return { [this.idField]: String(id), ...data } as T;
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async deleteVector(id: Id): Promise<T> {
    return this.deleteById(id);
  }

  // ─── Repository methods ───────────────────────────────────────────────────

  async findAll(params?: QueryParams): Promise<T[]> {
    try {
      if (params?.where) {
        const limit = params.limit ?? 1000;
        const topK = params.skip != null ? params.skip + limit : limit;
        const response = await this.index.query({
          vector: Array(this.vectorDimension).fill(0) as number[],
          topK,
          includeMetadata: true,
          filter: toPineconeFilter(params.where as WhereClause),
        });
        const matches = response.matches ?? [];
        const startIdx = params.skip ?? 0;
        return matches.slice(startIdx).map((m) =>
          this.fromRecord(m.id, (m.metadata ?? {}) as Record<string, unknown>),
        );
      }

      // Full scan: paginate IDs then batch-fetch records
      const ids: string[] = [];
      let paginationToken: string | undefined;
      do {
        const page = await this.index.listPaginated({
          limit: 100,
          ...(paginationToken ? { paginationToken } : {}),
        });
        for (const v of page.vectors ?? []) {
          if (v.id) ids.push(v.id);
        }
        paginationToken = page.pagination?.next;
      } while (paginationToken);

      if (ids.length === 0) return [];

      const startIdx = params?.skip ?? 0;
      const endIdx = params?.limit != null ? startIdx + params.limit : ids.length;
      const pageIds = ids.slice(startIdx, endIdx);
      if (pageIds.length === 0) return [];

      return this.fetchByIds(pageIds);
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  /**
   * Fetch one page of records using Pinecone's native list pagination. The returned `cursor`
   * is Pinecone's opaque `paginationToken`; pass it back as `params.cursor` for the next page.
   * `where`, `skip`, and `sort` are rejected — Pinecone's list API enumerates IDs only and
   * cannot filter or order.
   */
  async findPage(params?: QueryParams & { cursor?: string }): Promise<CursorPage<T>> {
    if (params?.where) {
      throw new BadRequest(
        "where is not supported by findPage() on @mantlejs/pinecone.",
        undefined,
        undefined,
        "Pinecone's list API cannot filter by metadata. Use findAll() with where, or findSimilar() for filtered vector search.",
      );
    }
    if (params?.skip != null) {
      throw new BadRequest(
        "skip is not supported by findPage() on @mantlejs/pinecone.",
        undefined,
        undefined,
        "Cursor pagination replaces offsets — iterate pages via the returned cursor, or use findAll() with skip/limit.",
      );
    }
    if (params?.sort) {
      throw new BadRequest(
        "sort is not supported by findPage() on @mantlejs/pinecone.",
        undefined,
        undefined,
        "Pinecone's list API returns IDs in index order. Use findAll() when ordering matters.",
      );
    }

    try {
      const page = await this.index.listPaginated({
        limit: params?.limit ?? LIST_PAGE_SIZE,
        ...(params?.cursor !== undefined ? { paginationToken: params.cursor } : {}),
      });
      const ids = (page.vectors ?? []).map((v) => v.id).filter((id): id is string => Boolean(id));
      const data = ids.length > 0 ? await this.fetchByIds(ids) : [];
      return { data, cursor: page.pagination?.next };
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async findById(id: Id): Promise<T | null> {
    try {
      const result = await this.index.fetch({ ids: [String(id)] });
      const record = result.records[String(id)];
      if (!record) return null;
      return this.fromRecord(record.id, (record.metadata ?? {}) as Record<string, unknown>);
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async save(data: D): Promise<T> {
    try {
      const raw = data as Record<string, unknown>;
      const id = (raw[this.idField] as string | undefined) ?? crypto.randomUUID();
      const now = new Date().toISOString();
      const augmented: Record<string, unknown> = {
        ...raw,
        [this.idField]: id,
        ...(this.timestamps ? { createdAt: now, updatedAt: now } : {}),
      };
      const metadata = this.toMetadata(augmented);
      const zeroVector = Array(this.vectorDimension).fill(0) as number[];
      await this.index.upsert({ records: [{ id, values: zeroVector, metadata }] });
      return augmented as T;
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async saveAll(data: D[]): Promise<T[]> {
    return Promise.all(data.map((d) => this.save(d)));
  }

  async updateById(id: Id, data: D): Promise<T> {
    try {
      const existing = await this.findById(id);
      if (!existing) throw new NotFound(`No record found with ${this.idField} = ${id}`);
      const now = new Date().toISOString();
      const updated: Record<string, unknown> = {
        ...data as Record<string, unknown>,
        [this.idField]: String(id),
        ...(this.timestamps ? { updatedAt: now } : {}),
      };
      const current = await this.index.fetch({ ids: [String(id)] });
      const values = current.records[String(id)]?.values ?? (Array(this.vectorDimension).fill(0) as number[]);
      await this.index.upsert({ records: [{ id: String(id), values, metadata: this.toMetadata(updated) }] });
      return updated as T;
    } catch (err) {
      if (err instanceof NotFound) throw err;
      throw this.wrapError(err);
    }
  }

  async patchById(id: Id, data: D): Promise<T> {
    try {
      const existing = await this.findById(id);
      if (!existing) throw new NotFound(`No record found with ${this.idField} = ${id}`);
      const filtered = Object.fromEntries(
        Object.entries(data as Record<string, unknown>).filter(([, v]) => v !== undefined),
      );
      const now = new Date().toISOString();
      const patched: Record<string, unknown> = {
        ...existing,
        ...filtered,
        [this.idField]: String(id),
        ...(this.timestamps ? { updatedAt: now } : {}),
      };
      const current = await this.index.fetch({ ids: [String(id)] });
      const values = current.records[String(id)]?.values ?? (Array(this.vectorDimension).fill(0) as number[]);
      await this.index.upsert({ records: [{ id: String(id), values, metadata: this.toMetadata(patched) }] });
      return patched as T;
    } catch (err) {
      if (err instanceof NotFound) throw err;
      throw this.wrapError(err);
    }
  }

  async deleteById(id: Id): Promise<T> {
    try {
      const existing = await this.findById(id);
      if (!existing) throw new NotFound(`No record found with ${this.idField} = ${id}`);
      await this.index.deleteOne({ id: String(id) });
      return existing;
    } catch (err) {
      if (err instanceof NotFound) throw err;
      throw this.wrapError(err);
    }
  }

  async count(params?: QueryParams): Promise<number> {
    try {
      if (!params?.where) {
        const stats = await this.index.describeIndexStats();
        return stats.namespaces?.[this.namespace]?.recordCount ?? stats.totalRecordCount ?? 0;
      }
      const all = await this.findAll({ where: params.where });
      return all.length;
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  protected fromRecord(id: string, metadata: Record<string, unknown>): T {
    return { [this.idField]: id, ...metadata } as T;
  }

  protected toMetadata(data: Record<string, unknown>): RecordMetadata {
    return Object.fromEntries(Object.entries(data).filter(([k]) => k !== this.idField)) as RecordMetadata;
  }

  private async fetchByIds(ids: string[]): Promise<T[]> {
    const results: T[] = [];
    for (let i = 0; i < ids.length; i += FETCH_BATCH_SIZE) {
      const batch = ids.slice(i, i + FETCH_BATCH_SIZE);
      const fetched = await this.index.fetch({ ids: batch });
      for (const record of Object.values(fetched.records)) {
        results.push(this.fromRecord(record.id, (record.metadata ?? {}) as Record<string, unknown>));
      }
    }
    return results;
  }

  protected wrapError(err: unknown): Error {
    if (err instanceof MantleError) return err;
    if (err instanceof Error) return new GeneralError(err.message);
    return new GeneralError("An unknown Pinecone error occurred");
  }
}
