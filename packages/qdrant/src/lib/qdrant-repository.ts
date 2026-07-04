import type { QdrantClient } from "@qdrant/js-client-rest";
import type { Id, QueryParams, VectorRepository } from "@mantlejs/mantle";
import { GeneralError, NotFound } from "@mantlejs/mantle";
import type { MantleApplication } from "@mantlejs/mantle";
import { toQdrantFilter } from "./qdrant-filter.js";
import type { WhereClause } from "./qdrant-filter.js";

const SCROLL_PAGE_SIZE = 100;

/**
 * A Mantle `VectorRepository<T>` implementation backed by a Qdrant vector collection.
 *
 * Records are stored as Qdrant points. The `idField` value is the Qdrant point ID;
 * all other fields are stored in the point payload. Call `upsertVector` to attach a real
 * embedding — `save` / `saveAll` insert a zero vector placeholder that is later replaced.
 *
 * The collection is created automatically on the first write if it does not exist.
 *
 * @template T  The entity shape. Must extend `Record<string, unknown>`.
 * @template D  The write shape (defaults to `Partial<T>`).
 */
export abstract class QdrantRepository<T extends Record<string, unknown>, D = Partial<T>>
  implements VectorRepository<T, D>
{
  protected readonly client: QdrantClient;

  /** The Qdrant collection name to target. */
  abstract readonly collectionName: string;
  /** Number of dimensions for the vector space — must match the collection's configuration. */
  abstract readonly vectorSize: number;

  /** The payload key that stores the record id. @default "id" */
  readonly idField: string = "id";
  /** When true, `save` / `saveAll` / `updateById` / `patchById` write ISO-8601 timestamps. @default true */
  readonly timestamps: boolean = true;

  private _collectionEnsured = false;

  constructor(app: MantleApplication) {
    this.client = app.get<QdrantClient>("qdrant");
  }

  // ─── Collection management ─────────────────────────────────────────────────

  protected async ensureCollection(): Promise<void> {
    if (this._collectionEnsured) return;
    const result = await this.client.collectionExists(this.collectionName);
    if (!result.exists) {
      await this.client.createCollection(this.collectionName, {
        vectors: { size: this.vectorSize, distance: "Cosine" },
      });
    }
    this._collectionEnsured = true;
  }

  // ─── VectorRepository methods ─────────────────────────────────────────────

  async findSimilar(vector: number[], topK: number, params?: QueryParams): Promise<T[]> {
    try {
      const filter = params?.where ? toQdrantFilter(params.where as WhereClause) : undefined;
      const results = await this.client.search(this.collectionName, {
        vector,
        limit: topK,
        with_payload: true,
        ...(filter ? { filter: filter as never } : {}),
      });
      return results.map((r) => this.fromPoint(r.id, (r.payload ?? {}) as Record<string, unknown>));
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async upsertVector(id: Id, vector: number[], data: Partial<T>): Promise<T> {
    try {
      await this.ensureCollection();
      const payload = this.toPayload(data as Record<string, unknown>);
      await this.client.upsert(this.collectionName, {
        points: [{ id: String(id), vector, payload }],
      });
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
      const filter = params?.where ? toQdrantFilter(params.where as WhereClause) : undefined;
      const skip = params?.skip ?? 0;
      const limit = params?.limit;

      let orderBy: { key: string; direction: string } | undefined;
      if (params?.sort) {
        const firstSort = Object.entries(params.sort)[0];
        if (firstSort) orderBy = { key: firstSort[0], direction: firstSort[1] };
      }

      if (limit != null) {
        const result = await this.client.scroll(this.collectionName, {
          ...(filter ? { filter: filter as never } : {}),
          limit: skip + limit,
          with_payload: true,
          ...(orderBy ? { order_by: orderBy as never } : {}),
        });
        return result.points.slice(skip).map((p) =>
          this.fromPoint(p.id, (p.payload ?? {}) as Record<string, unknown>),
        );
      }

      // Full scan via cursor-based pagination
      const all: T[] = [];
      let offset: string | number | undefined = undefined;
      do {
        const result = await this.client.scroll(this.collectionName, {
          ...(filter ? { filter: filter as never } : {}),
          limit: SCROLL_PAGE_SIZE,
          ...(offset != null ? { offset: offset as never } : {}),
          with_payload: true,
          ...(orderBy ? { order_by: orderBy as never } : {}),
        });
        for (const p of result.points) {
          all.push(this.fromPoint(p.id, (p.payload ?? {}) as Record<string, unknown>));
        }
        offset = result.next_page_offset as string | number | undefined;
      } while (offset != null);

      return skip > 0 ? all.slice(skip) : all;
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async findById(id: Id): Promise<T | null> {
    try {
      const results = await this.client.retrieve(this.collectionName, {
        ids: [String(id)],
        with_payload: true,
      });
      if (results.length === 0 || !results[0]) return null;
      const point = results[0];
      return this.fromPoint(point.id, (point.payload ?? {}) as Record<string, unknown>);
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async save(data: D): Promise<T> {
    try {
      await this.ensureCollection();
      const raw = data as Record<string, unknown>;
      const id = (raw[this.idField] as string | undefined) ?? crypto.randomUUID();
      const now = new Date().toISOString();
      const augmented: Record<string, unknown> = {
        ...raw,
        [this.idField]: id,
        ...(this.timestamps ? { createdAt: now, updatedAt: now } : {}),
      };
      const payload = this.toPayload(augmented);
      const zeroVector = Array(this.vectorSize).fill(0) as number[];
      await this.client.upsert(this.collectionName, {
        points: [{ id, vector: zeroVector, payload }],
      });
      return augmented as T;
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async saveAll(data: D[]): Promise<T[]> {
    try {
      await this.ensureCollection();
      const now = new Date().toISOString();
      const entities: T[] = [];
      const points: Array<{ id: string; vector: number[]; payload: Record<string, unknown> }> = [];
      const zeroVector = Array(this.vectorSize).fill(0) as number[];

      for (const item of data) {
        const raw = item as Record<string, unknown>;
        const id = (raw[this.idField] as string | undefined) ?? crypto.randomUUID();
        const augmented: Record<string, unknown> = {
          ...raw,
          [this.idField]: id,
          ...(this.timestamps ? { createdAt: now, updatedAt: now } : {}),
        };
        entities.push(augmented as T);
        points.push({ id, vector: zeroVector, payload: this.toPayload(augmented) });
      }

      await this.client.upsert(this.collectionName, { points });
      return entities;
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async updateById(id: Id, data: D): Promise<T> {
    try {
      const existing = await this.findById(id);
      if (!existing) throw new NotFound(`No record found with ${this.idField} = ${id}`);
      const now = new Date().toISOString();
      const updated: Record<string, unknown> = {
        ...(data as Record<string, unknown>),
        [this.idField]: String(id),
        ...(this.timestamps ? { updatedAt: now } : {}),
      };
      const current = await this.client.retrieve(this.collectionName, {
        ids: [String(id)],
        with_payload: false,
        with_vector: true,
      });
      const vector =
        (current[0]?.vector as number[] | undefined) ?? (Array(this.vectorSize).fill(0) as number[]);
      await this.client.upsert(this.collectionName, {
        points: [{ id: String(id), vector, payload: this.toPayload(updated) }],
      });
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
      const current = await this.client.retrieve(this.collectionName, {
        ids: [String(id)],
        with_payload: false,
        with_vector: true,
      });
      const vector =
        (current[0]?.vector as number[] | undefined) ?? (Array(this.vectorSize).fill(0) as number[]);
      await this.client.upsert(this.collectionName, {
        points: [{ id: String(id), vector, payload: this.toPayload(patched) }],
      });
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
      await this.client.delete(this.collectionName, { points: [String(id)] });
      return existing;
    } catch (err) {
      if (err instanceof NotFound) throw err;
      throw this.wrapError(err);
    }
  }

  async count(params?: QueryParams): Promise<number> {
    try {
      const filter = params?.where ? toQdrantFilter(params.where as WhereClause) : undefined;
      const result = await this.client.count(this.collectionName, {
        ...(filter ? { filter: filter as never } : {}),
        exact: true,
      });
      return result.count;
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  protected fromPoint(id: string | number, payload: Record<string, unknown>): T {
    return { [this.idField]: String(id), ...payload } as T;
  }

  protected toPayload(data: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(data).filter(([k]) => k !== this.idField));
  }

  protected wrapError(err: unknown): Error {
    if (err instanceof Error) return new GeneralError(err.message);
    return new GeneralError("An unknown Qdrant error occurred");
  }
}
