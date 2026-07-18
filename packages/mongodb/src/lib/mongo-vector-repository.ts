import type { Id, QueryParams, VectorRepository } from "@mantlejs/mantle";
import { toMongoFilter } from "./mongo-filter.js";
import type { WhereClause } from "./mongo-filter.js";
import { MongoRepository } from "./mongo-repository.js";

/** Atlas caps `numCandidates` at 10000 per `$vectorSearch` stage. */
const MAX_NUM_CANDIDATES = 10000;

/**
 * A `MongoRepository<T>` that also implements Mantle's `VectorRepository<T>` via
 * **MongoDB Atlas Vector Search** (`$vectorSearch` aggregation stage).
 *
 * Requirements — this is an Atlas feature, not core MongoDB:
 * - An Atlas cluster (M0 free tier works) running MongoDB 6.0.11+/7.0.2+.
 * - An Atlas Vector Search index named `vectorIndexName` on this collection, covering
 *   `vectorField` as `type: "vector"`. Fields referenced in a `findSimilar` where
 *   clause must be indexed as `type: "filter"` in the same index.
 *
 * Every `findSimilar` result carries the Atlas similarity score as `_score` —
 * HIGHER is more similar (score ∈ [0, 1] for cosine/dotProduct). The embedding
 * field itself is stripped from results.
 *
 * Register it with `VectorRepositoryService` to expose `POST /<path>/similar`
 * exactly like the Pinecone/Qdrant adapters.
 */
export abstract class MongoVectorRepository<T extends Record<string, unknown>, D = Partial<T>>
  extends MongoRepository<T, D>
  implements VectorRepository<T, D>
{
  /** Name of the Atlas Vector Search index on this collection. @default "vector_index" */
  readonly vectorIndexName: string = "vector_index";

  /** Document field storing the embedding. @default "embedding" */
  readonly vectorField: string = "embedding";

  /**
   * ANN candidate pool multiplier: `numCandidates = topK * candidateMultiplier`
   * (capped at Atlas's 10000 limit). Atlas recommends 10–20× for good recall.
   * @default 10
   */
  readonly candidateMultiplier: number = 10;

  // ─── VectorRepository implementation ──────────────────────────────────────

  /** Top-K nearest neighbours via `$vectorSearch`. HIGHER `_score` is more similar. */
  async findSimilar(vector: number[], topK: number, params?: QueryParams): Promise<Array<T & { _score: number }>> {
    try {
      const filter = params?.where ? toMongoFilter(params.where as WhereClause) : undefined;
      const pipeline = [
        {
          $vectorSearch: {
            index: this.vectorIndexName,
            path: this.vectorField,
            queryVector: vector,
            numCandidates: Math.min(topK * this.candidateMultiplier, MAX_NUM_CANDIDATES),
            limit: topK,
            ...(filter ? { filter } : {}),
          },
        },
        { $set: { _score: { $meta: "vectorSearchScore" } } },
        { $unset: this.vectorField },
      ];
      const docs = await this.collection.aggregate(pipeline, this.sessionOptions()).toArray();
      return docs.map((doc) => this.fromDocument(doc) as T & { _score: number });
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async upsertVector(id: Id, vector: number[], data: Partial<T>): Promise<T> {
    try {
      const now = new Date();
      const rest = Object.fromEntries(Object.entries(data as Record<string, unknown>).filter(([key]) => key !== "id"));
      const doc = await this.collection.findOneAndUpdate(
        { _id: this.toObjectId(id) },
        {
          $set: { ...rest, [this.vectorField]: vector, ...(this.timestamps ? { updatedAt: now } : {}) },
          ...(this.timestamps ? { $setOnInsert: { createdAt: now } } : {}),
        },
        { upsert: true, returnDocument: "after", ...this.sessionOptions() },
      );
      const entity = this.fromDocument(doc as unknown as Record<string, unknown>) as Record<string, unknown>;
      delete entity[this.vectorField];
      return entity as unknown as T;
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async deleteVector(id: Id): Promise<T> {
    return this.deleteById(id);
  }
}
