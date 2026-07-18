import { describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { MantleApplication } from "@mantlejs/mantle";
import { NotFound } from "@mantlejs/mantle";
import { MongoVectorRepository } from "./mongo-vector-repository.js";

interface Doc extends Record<string, unknown> {
  id: string;
  text: string;
}

const HEX_A = "665f1f77bcf86cd799439011";

// ─── Mock helpers ────────────────────────────────────────────────────────────

function makeSetup() {
  const aggregateCursor = { toArray: vi.fn().mockResolvedValue([]) };
  const collection = {
    aggregateCursor,
    aggregate: vi.fn().mockReturnValue(aggregateCursor),
    findOne: vi.fn().mockResolvedValue(null),
    findOneAndUpdate: vi.fn().mockResolvedValue(null),
    findOneAndDelete: vi.fn().mockResolvedValue(null),
  };
  const db = { collection: vi.fn().mockReturnValue(collection) };
  const client = { startSession: vi.fn() };
  const app = {
    get: vi.fn((key: string) => (key === "mongoClient" ? client : db)),
  } as unknown as MantleApplication;
  return { app, collection };
}

class TestRepo extends MongoVectorRepository<Doc> {
  readonly collectionName = "docs";
  override readonly timestamps = false;
}

class CustomRepo extends MongoVectorRepository<Doc> {
  readonly collectionName = "docs";
  override readonly vectorIndexName = "docs_embeddings";
  override readonly vectorField = "vector";
  override readonly candidateMultiplier = 20;
  override readonly timestamps = false;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("MongoVectorRepository", () => {
  describe("findSimilar", () => {
    it("runs a $vectorSearch pipeline with score projection and vector stripping", async () => {
      const { app, collection } = makeSetup();
      collection.aggregateCursor.toArray.mockResolvedValue([{ _id: new ObjectId(HEX_A), text: "hello", _score: 0.97 }]);

      const result = await new TestRepo(app).findSimilar([0.1, 0.2], 5);

      expect(collection.aggregate).toHaveBeenCalledWith(
        [
          {
            $vectorSearch: {
              index: "vector_index",
              path: "embedding",
              queryVector: [0.1, 0.2],
              numCandidates: 50,
              limit: 5,
            },
          },
          { $set: { _score: { $meta: "vectorSearchScore" } } },
          { $unset: "embedding" },
        ],
        {},
      );
      expect(result).toEqual([{ id: HEX_A, text: "hello", _score: 0.97 }]);
    });

    it("translates a where clause into the $vectorSearch filter", async () => {
      const { app, collection } = makeSetup();
      await new TestRepo(app).findSimilar([0.1], 3, { where: { tags: { $contains: "hot" } } });
      const pipeline = collection.aggregate.mock.calls[0]?.[0] as Array<Record<string, Record<string, unknown>>>;
      expect(pipeline[0]?.["$vectorSearch"]?.["filter"]).toEqual({ tags: "hot" });
    });

    it("honours custom index name, vector field and candidate multiplier", async () => {
      const { app, collection } = makeSetup();
      await new CustomRepo(app).findSimilar([0.1], 4);
      const pipeline = collection.aggregate.mock.calls[0]?.[0] as Array<Record<string, Record<string, unknown>>>;
      expect(pipeline[0]?.["$vectorSearch"]).toMatchObject({
        index: "docs_embeddings",
        path: "vector",
        numCandidates: 80,
        limit: 4,
      });
      expect(pipeline[2]).toEqual({ $unset: "vector" });
    });

    it("caps numCandidates at the Atlas limit of 10000", async () => {
      const { app, collection } = makeSetup();
      await new TestRepo(app).findSimilar([0.1], 5000);
      const pipeline = collection.aggregate.mock.calls[0]?.[0] as Array<Record<string, Record<string, unknown>>>;
      expect(pipeline[0]?.["$vectorSearch"]?.["numCandidates"]).toBe(10000);
    });
  });

  describe("upsertVector", () => {
    it("upserts the embedding with the record data and returns the entity without the vector", async () => {
      const { app, collection } = makeSetup();
      collection.findOneAndUpdate.mockResolvedValue({
        _id: new ObjectId(HEX_A),
        text: "hello",
        embedding: [0.1, 0.2],
      });

      const result = await new TestRepo(app).upsertVector(HEX_A, [0.1, 0.2], { id: HEX_A, text: "hello" });

      expect(collection.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: new ObjectId(HEX_A) },
        { $set: { text: "hello", embedding: [0.1, 0.2] } },
        { upsert: true, returnDocument: "after" },
      );
      expect(result).toEqual({ id: HEX_A, text: "hello" });
    });

    it("writes createdAt on insert and updatedAt on every upsert when timestamps are on", async () => {
      class Timestamped extends MongoVectorRepository<Doc> {
        readonly collectionName = "docs";
      }
      const { app, collection } = makeSetup();
      collection.findOneAndUpdate.mockResolvedValue({ _id: new ObjectId(HEX_A), text: "x" });

      await new Timestamped(app).upsertVector(HEX_A, [0.1], { text: "x" });

      const update = collection.findOneAndUpdate.mock.calls[0]?.[1] as Record<string, Record<string, unknown>>;
      expect(update["$set"]?.["updatedAt"]).toBeInstanceOf(Date);
      expect(update["$setOnInsert"]?.["createdAt"]).toBeInstanceOf(Date);
    });
  });

  describe("deleteVector", () => {
    it("delegates to deleteById", async () => {
      const { app, collection } = makeSetup();
      collection.findOneAndDelete.mockResolvedValue({ _id: new ObjectId(HEX_A), text: "gone" });
      const result = await new TestRepo(app).deleteVector(HEX_A);
      expect(collection.findOneAndDelete).toHaveBeenCalledWith({ _id: new ObjectId(HEX_A) }, {});
      expect(result).toEqual({ id: HEX_A, text: "gone" });
    });

    it("throws NotFound when the record does not exist", async () => {
      const { app } = makeSetup();
      await expect(new TestRepo(app).deleteVector(HEX_A)).rejects.toThrow(NotFound);
    });
  });
});
