import { describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { MantleApplication } from "@mantlejs/mantle";
import { BadRequest, Conflict, GeneralError, NotFound, Unavailable } from "@mantlejs/mantle";
import { MongoRepository } from "./mongo-repository.js";
import { MONGO_OPERATORS } from "./mongo-filter.js";

interface Article extends Record<string, unknown> {
  id: string;
  title: string;
  views: number;
}

const HEX_A = "665f1f77bcf86cd799439011";
const HEX_B = "665f1f77bcf86cd799439012";

// ─── Mock helpers ────────────────────────────────────────────────────────────

function makeCursor(docs: unknown[] = []) {
  return {
    sort: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
    toArray: vi.fn().mockResolvedValue(docs),
  };
}

function makeCollection() {
  const cursor = makeCursor();
  const aggregateCursor = { toArray: vi.fn().mockResolvedValue([]) };
  return {
    cursor,
    aggregateCursor,
    find: vi.fn().mockReturnValue(cursor),
    findOne: vi.fn().mockResolvedValue(null),
    insertOne: vi.fn().mockResolvedValue({ insertedId: new ObjectId(HEX_A) }),
    insertMany: vi.fn().mockResolvedValue({ insertedIds: {} }),
    findOneAndReplace: vi.fn().mockResolvedValue(null),
    findOneAndUpdate: vi.fn().mockResolvedValue(null),
    findOneAndDelete: vi.fn().mockResolvedValue(null),
    countDocuments: vi.fn().mockResolvedValue(0),
    aggregate: vi.fn().mockReturnValue(aggregateCursor),
  };
}

function makeSetup() {
  const collection = makeCollection();
  const db = { collection: vi.fn().mockReturnValue(collection) };
  const session = {
    withTransaction: vi.fn(async (fn: () => Promise<void>) => fn()),
    endSession: vi.fn().mockResolvedValue(undefined),
  };
  const client = { startSession: vi.fn().mockReturnValue(session) };
  const app = {
    get: vi.fn((key: string) => (key === "mongoClient" ? client : db)),
  } as unknown as MantleApplication;
  return { app, client, db, collection, session };
}

class TestRepo extends MongoRepository<Article> {
  readonly collectionName = "articles";
  override readonly timestamps = false;
}

class TimestampedRepo extends MongoRepository<Article> {
  readonly collectionName = "articles";
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("MongoRepository", () => {
  it("targets the collection named by collectionName", async () => {
    const { app, db } = makeSetup();
    await new TestRepo(app).findAll();
    expect(db.collection).toHaveBeenCalledWith("articles");
  });

  describe("describe", () => {
    it("reports adapter capabilities", () => {
      const { app } = makeSetup();
      expect(new TestRepo(app).describe()).toEqual({
        adapter: "@mantlejs/mongodb",
        operators: [...MONGO_OPERATORS],
        pagination: "offset",
        fullTextSearch: false,
      });
    });
  });

  describe("findAll", () => {
    it("finds with an empty filter when no params given", async () => {
      const { app, collection } = makeSetup();
      await new TestRepo(app).findAll();
      expect(collection.find).toHaveBeenCalledWith({}, {});
    });

    it("translates the where clause and maps _id to a string id", async () => {
      const { app, collection } = makeSetup();
      collection.cursor.toArray.mockResolvedValue([{ _id: new ObjectId(HEX_A), title: "Hello", views: 3 }]);
      const result = await new TestRepo(app).findAll({ where: { views: { $gt: 1 } } });
      expect(collection.find).toHaveBeenCalledWith({ views: { $gt: 1 } }, {});
      expect(result).toEqual([{ id: HEX_A, title: "Hello", views: 3 }]);
    });

    it("applies sort, skip, limit and select to the cursor", async () => {
      const { app, collection } = makeSetup();
      await new TestRepo(app).findAll({
        sort: { views: "desc" },
        skip: 5,
        limit: 10,
        select: ["title"],
      });
      expect(collection.cursor.sort).toHaveBeenCalledWith({ views: -1 });
      expect(collection.cursor.skip).toHaveBeenCalledWith(5);
      expect(collection.cursor.limit).toHaveBeenCalledWith(10);
      expect(collection.cursor.project).toHaveBeenCalledWith({ title: 1 });
    });

    it("converts id where clauses to ObjectId _id filters", async () => {
      const { app, collection } = makeSetup();
      await new TestRepo(app).findAll({ where: { id: HEX_A } });
      const filter = collection.find.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(filter["_id"]).toBeInstanceOf(ObjectId);
    });

    it("rejects $like with BadRequest", async () => {
      const { app } = makeSetup();
      await expect(new TestRepo(app).findAll({ where: { title: { $like: "%x%" } } })).rejects.toThrow(BadRequest);
    });
  });

  describe("findById", () => {
    it("looks up by ObjectId and maps the result", async () => {
      const { app, collection } = makeSetup();
      collection.findOne.mockResolvedValue({ _id: new ObjectId(HEX_A), title: "Hello", views: 1 });
      const result = await new TestRepo(app).findById(HEX_A);
      expect(collection.findOne).toHaveBeenCalledWith({ _id: new ObjectId(HEX_A) }, {});
      expect(result).toEqual({ id: HEX_A, title: "Hello", views: 1 });
    });

    it("returns null when no document matches", async () => {
      const { app } = makeSetup();
      expect(await new TestRepo(app).findById(HEX_A)).toBeNull();
    });

    it("throws BadRequest for a malformed id", async () => {
      const { app } = makeSetup();
      await expect(new TestRepo(app).findById("nope")).rejects.toThrow(BadRequest);
    });
  });

  describe("save", () => {
    it("inserts and returns the entity with the driver-assigned id", async () => {
      const { app, collection } = makeSetup();
      const result = await new TestRepo(app).save({ title: "New", views: 0 });
      expect(collection.insertOne).toHaveBeenCalledWith({ title: "New", views: 0 }, {});
      expect(result).toEqual({ id: HEX_A, title: "New", views: 0 });
    });

    it("writes createdAt/updatedAt Date fields when timestamps are on", async () => {
      const { app, collection } = makeSetup();
      await new TimestampedRepo(app).save({ title: "New", views: 0 });
      const doc = collection.insertOne.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(doc["createdAt"]).toBeInstanceOf(Date);
      expect(doc["updatedAt"]).toBeInstanceOf(Date);
    });

    it("honours a caller-provided id by writing it as _id", async () => {
      const { app, collection } = makeSetup();
      const result = await new TestRepo(app).save({ id: HEX_B, title: "New", views: 0 });
      const doc = collection.insertOne.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(doc["_id"]).toBeInstanceOf(ObjectId);
      expect((doc["_id"] as ObjectId).toHexString()).toBe(HEX_B);
      expect(result["id"]).toBe(HEX_B);
    });

    it("wraps duplicate-key errors as Conflict", async () => {
      const { app, collection } = makeSetup();
      const dup = Object.assign(new Error("E11000 duplicate key"), { code: 11000 });
      collection.insertOne.mockRejectedValue(dup);
      await expect(new TestRepo(app).save({ title: "Dup", views: 0 })).rejects.toThrow(Conflict);
    });
  });

  describe("saveAll", () => {
    it("bulk-inserts and maps driver-assigned ids by index", async () => {
      const { app, collection } = makeSetup();
      collection.insertMany.mockResolvedValue({ insertedIds: { 0: new ObjectId(HEX_A), 1: new ObjectId(HEX_B) } });
      const result = await new TestRepo(app).saveAll([
        { title: "A", views: 1 },
        { title: "B", views: 2 },
      ]);
      expect(collection.insertMany).toHaveBeenCalledWith(
        [
          { title: "A", views: 1 },
          { title: "B", views: 2 },
        ],
        {},
      );
      expect(result.map((r) => r.id)).toEqual([HEX_A, HEX_B]);
    });
  });

  describe("updateById", () => {
    it("replaces the document and returns the mapped result", async () => {
      const { app, collection } = makeSetup();
      collection.findOneAndReplace.mockResolvedValue({ _id: new ObjectId(HEX_A), title: "Replaced", views: 9 });
      const result = await new TestRepo(app).updateById(HEX_A, { title: "Replaced", views: 9 });
      expect(collection.findOneAndReplace).toHaveBeenCalledWith(
        { _id: new ObjectId(HEX_A) },
        { title: "Replaced", views: 9 },
        { returnDocument: "after" },
      );
      expect(result).toEqual({ id: HEX_A, title: "Replaced", views: 9 });
    });

    it("never sends _id inside the replacement document", async () => {
      const { app, collection } = makeSetup();
      collection.findOneAndReplace.mockResolvedValue({ _id: new ObjectId(HEX_A), title: "x", views: 0 });
      await new TestRepo(app).updateById(HEX_A, { id: HEX_A, title: "x", views: 0 });
      const replacement = collection.findOneAndReplace.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(replacement["_id"]).toBeUndefined();
      expect(replacement["id"]).toBeUndefined();
    });

    it("throws NotFound when no document matches", async () => {
      const { app } = makeSetup();
      await expect(new TestRepo(app).updateById(HEX_A, { title: "x", views: 0 })).rejects.toThrow(NotFound);
    });
  });

  describe("patchById", () => {
    it("applies a $set with undefined values and the id key filtered out", async () => {
      const { app, collection } = makeSetup();
      collection.findOneAndUpdate.mockResolvedValue({ _id: new ObjectId(HEX_A), title: "Patched", views: 2 });
      const result = await new TestRepo(app).patchById(HEX_A, {
        id: HEX_A,
        title: "Patched",
        views: undefined,
      } as Partial<Article>);
      expect(collection.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: new ObjectId(HEX_A) },
        { $set: { title: "Patched" } },
        { returnDocument: "after" },
      );
      expect(result).toEqual({ id: HEX_A, title: "Patched", views: 2 });
    });

    it("bumps updatedAt when timestamps are on", async () => {
      const { app, collection } = makeSetup();
      collection.findOneAndUpdate.mockResolvedValue({ _id: new ObjectId(HEX_A), title: "x", views: 0 });
      await new TimestampedRepo(app).patchById(HEX_A, { title: "x" });
      const update = collection.findOneAndUpdate.mock.calls[0]?.[1] as { $set: Record<string, unknown> };
      expect(update.$set["updatedAt"]).toBeInstanceOf(Date);
    });

    it("returns the existing document for an empty patch instead of an empty $set", async () => {
      const { app, collection } = makeSetup();
      collection.findOne.mockResolvedValue({ _id: new ObjectId(HEX_A), title: "Same", views: 1 });
      const result = await new TestRepo(app).patchById(HEX_A, {});
      expect(collection.findOneAndUpdate).not.toHaveBeenCalled();
      expect(result).toEqual({ id: HEX_A, title: "Same", views: 1 });
    });

    it("throws NotFound when no document matches", async () => {
      const { app } = makeSetup();
      await expect(new TestRepo(app).patchById(HEX_A, { title: "x" })).rejects.toThrow(NotFound);
    });
  });

  describe("deleteById", () => {
    it("deletes and returns the removed document", async () => {
      const { app, collection } = makeSetup();
      collection.findOneAndDelete.mockResolvedValue({ _id: new ObjectId(HEX_A), title: "Gone", views: 0 });
      const result = await new TestRepo(app).deleteById(HEX_A);
      expect(collection.findOneAndDelete).toHaveBeenCalledWith({ _id: new ObjectId(HEX_A) }, {});
      expect(result).toEqual({ id: HEX_A, title: "Gone", views: 0 });
    });

    it("throws NotFound when no document matches", async () => {
      const { app } = makeSetup();
      await expect(new TestRepo(app).deleteById(HEX_A)).rejects.toThrow(NotFound);
    });
  });

  describe("count", () => {
    it("counts documents matching the translated filter", async () => {
      const { app, collection } = makeSetup();
      collection.countDocuments.mockResolvedValue(7);
      const result = await new TestRepo(app).count({ where: { views: { $gte: 1 } } });
      expect(collection.countDocuments).toHaveBeenCalledWith({ views: { $gte: 1 } }, {});
      expect(result).toBe(7);
    });
  });

  describe("withTransaction", () => {
    it("runs the callback with a session-bound repository and ends the session", async () => {
      const { app, client, collection, session } = makeSetup();
      const repo = new TestRepo(app);
      collection.findOne.mockResolvedValue({ _id: new ObjectId(HEX_A), title: "x", views: 0 });

      const result = await repo.withTransaction(async (txRepo) => {
        await txRepo.findById(HEX_A);
        return "done";
      });

      expect(result).toBe("done");
      expect(client.startSession).toHaveBeenCalled();
      expect(session.withTransaction).toHaveBeenCalled();
      expect(collection.findOne).toHaveBeenCalledWith({ _id: new ObjectId(HEX_A) }, { session });
      expect(session.endSession).toHaveBeenCalled();
    });

    it("leaves the original repository session-free", async () => {
      const { app, collection } = makeSetup();
      const repo = new TestRepo(app);
      await repo.withTransaction(async () => undefined);
      await repo.findAll();
      expect(collection.find).toHaveBeenCalledWith({}, {});
    });

    it("ends the session even when the transaction throws", async () => {
      const { app, session } = makeSetup();
      session.withTransaction.mockRejectedValue(new Error("aborted"));
      await expect(new TestRepo(app).withTransaction(async () => undefined)).rejects.toThrow(GeneralError);
      expect(session.endSession).toHaveBeenCalled();
    });
  });

  describe("error wrapping", () => {
    it("maps network errors to Unavailable", async () => {
      const { app, collection } = makeSetup();
      const netErr = new Error("connection refused");
      netErr.name = "MongoNetworkError";
      collection.findOne.mockRejectedValue(netErr);
      await expect(new TestRepo(app).findById(HEX_A)).rejects.toThrow(Unavailable);
    });

    it("wraps unknown driver errors as GeneralError", async () => {
      const { app, collection } = makeSetup();
      collection.findOne.mockRejectedValue(new Error("boom"));
      await expect(new TestRepo(app).findById(HEX_A)).rejects.toThrow(GeneralError);
    });
  });
});
