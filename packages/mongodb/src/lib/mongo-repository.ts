import { ObjectId } from "mongodb";
import type { ClientSession, Collection, Db, Document, MongoClient } from "mongodb";
import type { Id, MantleApplication, QueryParams, Repository, RepositoryCapabilities } from "@mantlejs/mantle";
import { BadRequest, Conflict, GeneralError, MantleError, NotFound, Unavailable } from "@mantlejs/mantle";
import { MONGO_OPERATORS, toMongoFilter, toMongoProjection, toMongoSort } from "./mongo-filter.js";
import type { WhereClause } from "./mongo-filter.js";

/**
 * A Mantle `Repository<T>` implementation backed by a MongoDB collection, using the
 * official `mongodb` driver directly — no Mongoose, consistent with the
 * query-builder-not-ORM approach `@mantlejs/knex` takes for SQL.
 *
 * Mongo's native `_id` (`ObjectId`) is exposed as `id: string` (hex) at the
 * `Repository<T>` boundary — callers never see a raw `ObjectId`. Dot-path where keys
 * and `$contains` are supported natively; `$like`/`$ilike`/`$notlike` are not — use
 * the raw `collection` escape hatch with `$regex` for pattern matching.
 *
 * @template T  The entity shape. Must extend `Record<string, unknown>`.
 * @template D  The write shape (defaults to `Partial<T>`).
 */
export abstract class MongoRepository<T extends Record<string, unknown>, D = Partial<T>> implements Repository<T, D> {
  protected readonly client: MongoClient;
  protected readonly db: Db;

  /** The MongoDB collection name to target. */
  abstract readonly collectionName: string;

  /** When true, writes maintain `createdAt`/`updatedAt` as BSON `Date` fields. @default true */
  readonly timestamps: boolean = true;

  /** Session bound by `withTransaction()` — every driver call passes it when set. */
  protected _session?: ClientSession;

  constructor(app: MantleApplication) {
    this.client = app.get<MongoClient>("mongoClient");
    this.db = app.get<Db>("mongoDb");
  }

  /** Escape hatch — the underlying driver `Collection` for native queries (`$regex`, aggregations, …). */
  protected get collection(): Collection<Document> {
    return this.db.collection(this.collectionName);
  }

  describe(): RepositoryCapabilities {
    return {
      adapter: "@mantlejs/mongodb",
      operators: [...MONGO_OPERATORS],
      pagination: "offset",
      fullTextSearch: false,
    };
  }

  // ─── Repository implementation ────────────────────────────────────────────

  async findAll(params?: QueryParams): Promise<T[]> {
    try {
      const filter = params?.where ? toMongoFilter(params.where as WhereClause) : {};
      let cursor = this.collection.find(filter, this.sessionOptions());
      if (params?.sort) cursor = cursor.sort(toMongoSort(params.sort));
      if (params?.skip) cursor = cursor.skip(params.skip);
      if (params?.limit != null) cursor = cursor.limit(params.limit);
      if (params?.select && params.select.length > 0) cursor = cursor.project(toMongoProjection(params.select));
      const docs = await cursor.toArray();
      return docs.map((doc) => this.fromDocument(doc));
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async findById(id: Id): Promise<T | null> {
    try {
      const doc = await this.collection.findOne({ _id: this.toObjectId(id) }, this.sessionOptions());
      return doc ? this.fromDocument(doc) : null;
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async save(data: D): Promise<T> {
    try {
      const doc = this.toDocument(data as Record<string, unknown>, "create");
      const result = await this.collection.insertOne(doc, this.sessionOptions());
      return this.fromDocument({ ...doc, _id: doc["_id"] ?? result.insertedId });
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async saveAll(data: D[]): Promise<T[]> {
    try {
      const now = new Date();
      const docs = data.map((item) => this.toDocument(item as Record<string, unknown>, "create", now));
      const result = await this.collection.insertMany(docs, this.sessionOptions());
      return docs.map((doc, index) => this.fromDocument({ ...doc, _id: doc["_id"] ?? result.insertedIds[index] }));
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async updateById(id: Id, data: D): Promise<T> {
    try {
      const replacement = this.toDocument(data as Record<string, unknown>, "update");
      delete replacement["_id"]; // the filter pins the id; a replacement document may not carry one
      const doc = await this.collection.findOneAndReplace({ _id: this.toObjectId(id) }, replacement, {
        returnDocument: "after",
        ...this.sessionOptions(),
      });
      if (!doc) throw new NotFound(`No record found with id = ${String(id)}`);
      return this.fromDocument(doc);
    } catch (err) {
      if (err instanceof NotFound) throw err;
      throw this.wrapError(err);
    }
  }

  async patchById(id: Id, data: D): Promise<T> {
    try {
      const filtered = Object.fromEntries(
        Object.entries(data as Record<string, unknown>).filter(([key, value]) => key !== "id" && value !== undefined),
      );
      const changes: Record<string, unknown> = {
        ...filtered,
        ...(this.timestamps ? { updatedAt: new Date() } : {}),
      };

      if (Object.keys(changes).length === 0) {
        // Nothing to set — MongoDB rejects an empty $set, so just assert existence
        const existing = await this.findById(id);
        if (!existing) throw new NotFound(`No record found with id = ${String(id)}`);
        return existing;
      }

      const doc = await this.collection.findOneAndUpdate(
        { _id: this.toObjectId(id) },
        { $set: changes },
        { returnDocument: "after", ...this.sessionOptions() },
      );
      if (!doc) throw new NotFound(`No record found with id = ${String(id)}`);
      return this.fromDocument(doc);
    } catch (err) {
      if (err instanceof NotFound) throw err;
      throw this.wrapError(err);
    }
  }

  async deleteById(id: Id): Promise<T> {
    try {
      const doc = await this.collection.findOneAndDelete({ _id: this.toObjectId(id) }, this.sessionOptions());
      if (!doc) throw new NotFound(`No record found with id = ${String(id)}`);
      return this.fromDocument(doc);
    } catch (err) {
      if (err instanceof NotFound) throw err;
      throw this.wrapError(err);
    }
  }

  async count(params?: QueryParams): Promise<number> {
    try {
      const filter = params?.where ? toMongoFilter(params.where as WhereClause) : {};
      return await this.collection.countDocuments(filter, this.sessionOptions());
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  // ─── Transactions ─────────────────────────────────────────────────────────

  /**
   * Run a block of repository calls inside one MongoDB transaction. Requires the
   * deployment to be a replica set — true for every Atlas cluster including free-tier
   * M0; standalone servers throw the driver's native error. The callback receives a
   * session-bound copy of this repository; calls on the original instance are NOT
   * part of the transaction.
   */
  async withTransaction<R>(fn: (txRepo: this) => Promise<R>): Promise<R> {
    const session = this.client.startSession();
    try {
      let result!: R;
      await session.withTransaction(async () => {
        const txRepo = Object.create(this) as this;
        txRepo._session = session;
        result = await fn(txRepo);
      });
      return result;
    } catch (err) {
      throw this.wrapError(err);
    } finally {
      await session.endSession();
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  protected sessionOptions(): { session?: ClientSession } {
    return this._session ? { session: this._session } : {};
  }

  /** Convert a boundary `Id` to an `ObjectId`, rejecting malformed ids loudly. */
  protected toObjectId(id: Id): ObjectId {
    if (!ObjectId.isValid(String(id))) {
      throw new BadRequest(
        `Invalid id: ${String(id)}`,
        undefined,
        undefined,
        "MongoDB ids are 24-character hex strings (ObjectId). Pass the id exactly as returned by a previous call.",
      );
    }
    return new ObjectId(String(id));
  }

  /** Map a driver document to the entity shape: `_id: ObjectId` becomes `id: string`. */
  protected fromDocument(doc: Record<string, unknown>): T {
    const { _id, ...rest } = doc;
    return { ...rest, id: _id instanceof ObjectId ? _id.toHexString() : String(_id) } as unknown as T;
  }

  /** Map boundary data to a driver document: `id` becomes `_id`, timestamps applied. */
  protected toDocument(
    data: Record<string, unknown>,
    op: "create" | "update",
    now = new Date(),
  ): Record<string, unknown> {
    const { id, ...rest } = data;
    return {
      ...rest,
      ...(id !== undefined ? { _id: this.toObjectId(id as Id) } : {}),
      ...(this.timestamps ? (op === "create" ? { createdAt: now, updatedAt: now } : { updatedAt: now }) : {}),
    };
  }

  protected wrapError(err: unknown): Error {
    if (err instanceof MantleError) return err;
    if (!(err instanceof Error)) return new GeneralError("An unknown MongoDB error occurred");
    const code = (err as { code?: number | string }).code;
    if (code === 11000 || code === 11001) {
      return new Conflict(err.message, undefined, undefined, "A record with the same unique key already exists.");
    }
    if (err.name === "MongoNetworkError" || err.name === "MongoServerSelectionError") {
      return new Unavailable(err.message);
    }
    return new GeneralError(err.message);
  }
}
