import { describe, expect, it, vi } from "vitest";
import type { MantleApplication } from "@mantlejs/mantle";
import { BadRequest, GeneralError, NotFound } from "@mantlejs/mantle";

vi.mock("@qdrant/js-client-rest", () => ({
  QdrantClient: vi.fn(),
}));

const { QdrantRepository } = await import("./qdrant-repository.js");
const { QDRANT_OPERATORS } = await import("./qdrant-filter.js");

interface Article extends Record<string, unknown> {
  id: string;
  title: string;
  category: string;
}

// ─── Mock helpers ────────────────────────────────────────────────────────────

function makeClient() {
  return {
    collectionExists: vi.fn().mockResolvedValue({ exists: true }),
    createCollection: vi.fn().mockResolvedValue(true),
    search: vi.fn().mockResolvedValue([]),
    scroll: vi.fn().mockResolvedValue({ points: [], next_page_offset: null }),
    retrieve: vi.fn().mockResolvedValue([]),
    upsert: vi.fn().mockResolvedValue({ status: "acknowledged" }),
    delete: vi.fn().mockResolvedValue({ status: "acknowledged" }),
    count: vi.fn().mockResolvedValue({ count: 0 }),
  };
}

function makeSetup() {
  const client = makeClient();
  const app = {
    get: vi.fn().mockReturnValue(client),
    set: vi.fn().mockReturnThis(),
  } as unknown as MantleApplication;
  return { client, app };
}

// ─── Concrete test repositories ───────────────────────────────────────────────

class TestRepo extends QdrantRepository<Article> {
  readonly collectionName = "articles";
  readonly vectorSize = 3;
  override readonly timestamps = false;
}

class TestRepoWithTimestamps extends QdrantRepository<Article> {
  readonly collectionName = "articles";
  readonly vectorSize = 3;
}

class TestRepoCustomTimestampFields extends QdrantRepository<Article> {
  readonly collectionName = "articles";
  readonly vectorSize = 3;
  override readonly createdAtField = "created_at";
  override readonly updatedAtField = "updated_at";
}

interface Account extends Record<string, unknown> {
  id: string;
  userName: string;
}

class TestRepoFieldMap extends QdrantRepository<Account> {
  readonly collectionName = "accounts";
  readonly vectorSize = 3;
  override readonly timestamps = false;
  override readonly fieldMap = { userName: "user_name" };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("QdrantRepository", () => {
  describe("ensureCollection", () => {
    it("checks if the collection exists before first write", async () => {
      const { client, app } = makeSetup();
      const repo = new TestRepo(app);
      await repo.save({ title: "Doc", category: "tech" } as Partial<Article>);
      expect(client.collectionExists).toHaveBeenCalledWith("articles");
    });

    it("creates the collection when it does not exist", async () => {
      const { client, app } = makeSetup();
      client.collectionExists.mockResolvedValue({ exists: false });
      const repo = new TestRepo(app);
      await repo.save({ title: "Doc", category: "tech" } as Partial<Article>);
      expect(client.createCollection).toHaveBeenCalledWith("articles", {
        vectors: { size: 3, distance: "Cosine" },
      });
    });

    it("only checks existence once across multiple writes", async () => {
      const { client, app } = makeSetup();
      const repo = new TestRepo(app);
      await repo.save({ id: "1", title: "A", category: "x" } as Partial<Article>);
      await repo.save({ id: "2", title: "B", category: "y" } as Partial<Article>);
      expect(client.collectionExists).toHaveBeenCalledTimes(1);
    });
  });

  describe("findSimilar", () => {
    it("calls search with vector and topK", async () => {
      const { client, app } = makeSetup();
      await new TestRepo(app).findSimilar([0.1, 0.2, 0.3], 5);
      expect(client.search).toHaveBeenCalledWith(
        "articles",
        expect.objectContaining({ vector: [0.1, 0.2, 0.3], limit: 5, with_payload: true }),
      );
    });

    it("applies a Qdrant filter when params.where is provided", async () => {
      const { client, app } = makeSetup();
      await new TestRepo(app).findSimilar([0.1, 0.2, 0.3], 5, { where: { category: "tech" } });
      expect(client.search).toHaveBeenCalledWith(
        "articles",
        expect.objectContaining({
          filter: { must: [{ key: "category", match: { value: "tech" } }] },
        }),
      );
    });

    it("maps scored points to domain entities with the match score as _score", async () => {
      const { client, app } = makeSetup();
      client.search.mockResolvedValue([{ id: "1", score: 0.9, payload: { title: "Doc", category: "tech" } }]);
      const result = await new TestRepo(app).findSimilar([0.1, 0.2, 0.3], 5);
      expect(result).toEqual([{ id: "1", title: "Doc", category: "tech", _score: 0.9 }]);
    });

    it("wraps errors as GeneralError", async () => {
      const { client, app } = makeSetup();
      client.search.mockRejectedValue(new Error("network error"));
      await expect(new TestRepo(app).findSimilar([0.1], 5)).rejects.toBeInstanceOf(GeneralError);
    });

    it("treats a missing payload as an empty object", async () => {
      const { client, app } = makeSetup();
      client.search.mockResolvedValue([{ id: "1", score: 0.5 }]);
      const result = await new TestRepo(app).findSimilar([0.1], 5);
      expect(result).toEqual([{ id: "1", _score: 0.5 }]);
    });
  });

  describe("upsertVector", () => {
    it("wraps a driver error", async () => {
      const { client, app } = makeSetup();
      client.upsert.mockRejectedValue(new Error("connection reset"));
      await expect(new TestRepo(app).upsertVector("1", [0.1], { title: "x" })).rejects.toBeInstanceOf(GeneralError);
    });

    it("upserts the point with the given vector and payload", async () => {
      const { client, app } = makeSetup();
      await new TestRepo(app).upsertVector("1", [0.1, 0.2, 0.3], { title: "Doc", category: "tech" });
      expect(client.upsert).toHaveBeenCalledWith("articles", {
        points: [{ id: "1", vector: [0.1, 0.2, 0.3], payload: { title: "Doc", category: "tech" } }],
      });
    });

    it("returns the entity with id and data", async () => {
      const { app } = makeSetup();
      const result = await new TestRepo(app).upsertVector("1", [0.1, 0.2, 0.3], {
        title: "Doc",
        category: "tech",
      });
      expect(result).toEqual({ id: "1", title: "Doc", category: "tech" });
    });
  });

  describe("deleteVector", () => {
    it("delegates to deleteById", async () => {
      const { client, app } = makeSetup();
      client.retrieve.mockResolvedValue([{ id: "1", payload: { title: "Doc", category: "tech" } }]);
      const result = await new TestRepo(app).deleteVector("1");
      expect(client.delete).toHaveBeenCalledWith("articles", { points: ["1"] });
      expect(result).toEqual({ id: "1", title: "Doc", category: "tech" });
    });
  });

  describe("findAll", () => {
    it("uses scroll with limit when params.limit is provided", async () => {
      const { client, app } = makeSetup();
      client.scroll.mockResolvedValue({ points: [], next_page_offset: null });
      await new TestRepo(app).findAll({ limit: 10 });
      expect(client.scroll).toHaveBeenCalledWith(
        "articles",
        expect.objectContaining({ limit: 10, with_payload: true }),
      );
    });

    it("accounts for skip when computing limit for scroll", async () => {
      const { client, app } = makeSetup();
      client.scroll.mockResolvedValue({ points: [], next_page_offset: null });
      await new TestRepo(app).findAll({ skip: 5, limit: 10 });
      expect(client.scroll).toHaveBeenCalledWith("articles", expect.objectContaining({ limit: 15 }));
    });

    it("paginates through all records when no limit is provided", async () => {
      const { client, app } = makeSetup();
      client.scroll
        .mockResolvedValueOnce({
          points: [{ id: "1", payload: { title: "A", category: "x" } }],
          next_page_offset: "tok",
        })
        .mockResolvedValueOnce({
          points: [{ id: "2", payload: { title: "B", category: "y" } }],
          next_page_offset: null,
        });
      const result = await new TestRepo(app).findAll();
      expect(client.scroll).toHaveBeenCalledTimes(2);
      expect(result).toHaveLength(2);
    });

    it("applies filter from params.where", async () => {
      const { client, app } = makeSetup();
      client.scroll.mockResolvedValue({ points: [], next_page_offset: null });
      await new TestRepo(app).findAll({ where: { category: "tech" }, limit: 5 });
      expect(client.scroll).toHaveBeenCalledWith(
        "articles",
        expect.objectContaining({
          filter: { must: [{ key: "category", match: { value: "tech" } }] },
        }),
      );
    });

    it("maps scroll results to domain entities", async () => {
      const { client, app } = makeSetup();
      client.scroll.mockResolvedValue({
        points: [
          { id: "1", payload: { title: "A", category: "x" } },
          { id: "2", payload: { title: "B", category: "y" } },
        ],
        next_page_offset: null,
      });
      const result = await new TestRepo(app).findAll({ limit: 10 });
      expect(result).toEqual([
        { id: "1", title: "A", category: "x" },
        { id: "2", title: "B", category: "y" },
      ]);
    });

    it("returns empty array when no records exist", async () => {
      const { app } = makeSetup();
      expect(await new TestRepo(app).findAll()).toEqual([]);
    });

    it("applies order_by from params.sort", async () => {
      const { client, app } = makeSetup();
      client.scroll.mockResolvedValue({ points: [], next_page_offset: null });
      await new TestRepo(app).findAll({ sort: { title: "asc" }, limit: 5 });
      expect(client.scroll).toHaveBeenCalledWith(
        "articles",
        expect.objectContaining({ order_by: { key: "title", direction: "asc" } }),
      );
    });

    it("ignores an empty sort object (no order_by)", async () => {
      const { client, app } = makeSetup();
      client.scroll.mockResolvedValue({ points: [], next_page_offset: null });
      await new TestRepo(app).findAll({ sort: {}, limit: 5 });
      expect(client.scroll).toHaveBeenCalledWith("articles", expect.not.objectContaining({ order_by: expect.anything() }));
    });

    it("applies filter, order_by, and the payload fallback during a full scan (no limit)", async () => {
      const { client, app } = makeSetup();
      client.scroll.mockResolvedValueOnce({ points: [{ id: "1" }], next_page_offset: null });
      const result = await new TestRepo(app).findAll({ where: { category: "tech" }, sort: { title: "asc" } });
      expect(client.scroll).toHaveBeenCalledWith(
        "articles",
        expect.objectContaining({
          filter: { must: [{ key: "category", match: { value: "tech" } }] },
          order_by: { key: "title", direction: "asc" },
        }),
      );
      expect(result).toEqual([{ id: "1" }]);
    });

    it("slices off the skip amount after a full scan with no limit", async () => {
      const { client, app } = makeSetup();
      client.scroll.mockResolvedValueOnce({
        points: [
          { id: "1", payload: { title: "A", category: "x" } },
          { id: "2", payload: { title: "B", category: "y" } },
        ],
        next_page_offset: null,
      });
      const result = await new TestRepo(app).findAll({ skip: 1 });
      expect(result).toEqual([{ id: "2", title: "B", category: "y" }]);
    });

    it("treats a missing payload as an empty object", async () => {
      const { client, app } = makeSetup();
      client.scroll.mockResolvedValue({ points: [{ id: "1" }], next_page_offset: null });
      const result = await new TestRepo(app).findAll({ limit: 5 });
      expect(result).toEqual([{ id: "1" }]);
    });

    it("wraps a driver error", async () => {
      const { client, app } = makeSetup();
      client.scroll.mockRejectedValue(new Error("connection reset"));
      await expect(new TestRepo(app).findAll()).rejects.toBeInstanceOf(GeneralError);
    });
  });

  describe("findById", () => {
    it("retrieves the point by id", async () => {
      const { client, app } = makeSetup();
      client.retrieve.mockResolvedValue([{ id: "42", payload: { title: "Doc", category: "tech" } }]);
      const result = await new TestRepo(app).findById("42");
      expect(client.retrieve).toHaveBeenCalledWith("articles", { ids: ["42"], with_payload: true });
      expect(result).toEqual({ id: "42", title: "Doc", category: "tech" });
    });

    it("returns null when the record is not found", async () => {
      const { app } = makeSetup();
      expect(await new TestRepo(app).findById("missing")).toBeNull();
    });

    it("treats a missing payload as an empty object", async () => {
      const { client, app } = makeSetup();
      client.retrieve.mockResolvedValue([{ id: "42" }]);
      expect(await new TestRepo(app).findById("42")).toEqual({ id: "42" });
    });
  });

  describe("save", () => {
    it("upserts with a zero vector placeholder", async () => {
      const { client, app } = makeSetup();
      await new TestRepo(app).save({ id: "1", title: "Doc", category: "tech" } as Partial<Article>);
      expect(client.upsert).toHaveBeenCalledWith("articles", {
        points: [{ id: "1", vector: [0, 0, 0], payload: expect.any(Object) }],
      });
    });

    it("stores fields as payload (excluding id)", async () => {
      const { client, app } = makeSetup();
      await new TestRepo(app).save({ id: "1", title: "Doc", category: "tech" } as Partial<Article>);
      const [, { points }] = (client.upsert as ReturnType<typeof vi.fn>).mock.calls[0] as [
        string,
        { points: Array<{ payload: Record<string, unknown> }> },
      ];
      expect(points[0].payload).toEqual({ title: "Doc", category: "tech" });
      expect(points[0].payload).not.toHaveProperty("id");
    });

    it("generates a UUID when no id is provided", async () => {
      const { client, app } = makeSetup();
      await new TestRepo(app).save({ title: "Doc", category: "tech" } as Partial<Article>);
      const [, { points }] = (client.upsert as ReturnType<typeof vi.fn>).mock.calls[0] as [
        string,
        { points: Array<{ id: string }> },
      ];
      expect(points[0].id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it("adds createdAt and updatedAt when timestamps is true", async () => {
      const { client, app } = makeSetup();
      await new TestRepoWithTimestamps(app).save({ id: "1", title: "Doc", category: "tech" } as Partial<Article>);
      const [, { points }] = (client.upsert as ReturnType<typeof vi.fn>).mock.calls[0] as [
        string,
        { points: Array<{ payload: Record<string, unknown> }> },
      ];
      expect(points[0].payload).toHaveProperty("createdAt");
      expect(points[0].payload).toHaveProperty("updatedAt");
    });

    it("does not add timestamps when timestamps is false", async () => {
      const { client, app } = makeSetup();
      await new TestRepo(app).save({ id: "1", title: "Doc", category: "tech" } as Partial<Article>);
      const [, { points }] = (client.upsert as ReturnType<typeof vi.fn>).mock.calls[0] as [
        string,
        { points: Array<{ payload: Record<string, unknown> }> },
      ];
      expect(points[0].payload).not.toHaveProperty("createdAt");
    });

    it("uses createdAtField/updatedAtField when overridden", async () => {
      const { client, app } = makeSetup();
      await new TestRepoCustomTimestampFields(app).save({
        id: "1",
        title: "Doc",
        category: "tech",
      } as Partial<Article>);
      const [, { points }] = (client.upsert as ReturnType<typeof vi.fn>).mock.calls[0] as [
        string,
        { points: Array<{ payload: Record<string, unknown> }> },
      ];
      expect(points[0].payload).toHaveProperty("created_at");
      expect(points[0].payload).toHaveProperty("updated_at");
      expect(points[0].payload).not.toHaveProperty("createdAt");
      expect(points[0].payload).not.toHaveProperty("updatedAt");
    });

    it("wraps a driver error", async () => {
      const { client, app } = makeSetup();
      client.upsert.mockRejectedValue(new Error("connection reset"));
      await expect(
        new TestRepo(app).save({ id: "1", title: "Doc", category: "tech" } as Partial<Article>),
      ).rejects.toBeInstanceOf(GeneralError);
    });
  });

  describe("saveAll", () => {
    it("batches all points in a single upsert call", async () => {
      const { client, app } = makeSetup();
      await new TestRepo(app).saveAll([
        { id: "1", title: "A", category: "x" } as Partial<Article>,
        { id: "2", title: "B", category: "y" } as Partial<Article>,
      ]);
      expect(client.upsert).toHaveBeenCalledTimes(1);
      const [, { points }] = (client.upsert as ReturnType<typeof vi.fn>).mock.calls[0] as [
        string,
        { points: unknown[] },
      ];
      expect(points).toHaveLength(2);
    });

    it("generates a UUID when no id is provided", async () => {
      const { client, app } = makeSetup();
      await new TestRepo(app).saveAll([{ title: "A", category: "x" } as Partial<Article>]);
      const [, { points }] = (client.upsert as ReturnType<typeof vi.fn>).mock.calls[0] as [
        string,
        { points: Array<{ id: string }> },
      ];
      expect(points[0].id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it("adds createdAt/updatedAt to every entity when timestamps is true", async () => {
      const { client, app } = makeSetup();
      await new TestRepoWithTimestamps(app).saveAll([{ id: "1", title: "A", category: "x" } as Partial<Article>]);
      const [, { points }] = (client.upsert as ReturnType<typeof vi.fn>).mock.calls[0] as [
        string,
        { points: Array<{ payload: Record<string, unknown> }> },
      ];
      expect(points[0].payload).toHaveProperty("createdAt");
      expect(points[0].payload).toHaveProperty("updatedAt");
    });

    it("wraps a driver error", async () => {
      const { client, app } = makeSetup();
      client.upsert.mockRejectedValue(new Error("connection reset"));
      await expect(new TestRepo(app).saveAll([{ title: "A", category: "x" } as Partial<Article>])).rejects.toBeInstanceOf(
        GeneralError,
      );
    });
  });

  describe("updateById", () => {
    it("replaces the record and preserves existing vector", async () => {
      const { client, app } = makeSetup();
      client.retrieve
        .mockResolvedValueOnce([{ id: "1", payload: { title: "Old", category: "x" } }])
        .mockResolvedValueOnce([{ id: "1", vector: [0.5, 0.6, 0.7] }]);
      await new TestRepo(app).updateById("1", { title: "New", category: "y" } as Partial<Article>);
      const [, { points }] = (client.upsert as ReturnType<typeof vi.fn>).mock.calls[0] as [
        string,
        { points: Array<{ vector: number[] }> },
      ];
      expect(points[0].vector).toEqual([0.5, 0.6, 0.7]);
    });

    it("throws NotFound when the record does not exist", async () => {
      const { app } = makeSetup();
      await expect(
        new TestRepo(app).updateById("missing", { title: "X", category: "y" } as Partial<Article>),
      ).rejects.toBeInstanceOf(NotFound);
    });

    it("falls back to a zero vector when the existing point has none", async () => {
      const { client, app } = makeSetup();
      client.retrieve
        .mockResolvedValueOnce([{ id: "1", payload: { title: "Old", category: "x" } }])
        .mockResolvedValueOnce([{ id: "1" }]);
      await new TestRepo(app).updateById("1", { title: "New", category: "y" } as Partial<Article>);
      const [, { points }] = (client.upsert as ReturnType<typeof vi.fn>).mock.calls[0] as [
        string,
        { points: Array<{ vector: number[] }> },
      ];
      expect(points[0].vector).toEqual([0, 0, 0]);
    });

    it("wraps a driver error other than not-found", async () => {
      const { client, app } = makeSetup();
      client.retrieve.mockResolvedValueOnce([{ id: "1", payload: { title: "Old", category: "x" } }]);
      client.upsert.mockRejectedValue(new Error("connection reset"));
      await expect(
        new TestRepo(app).updateById("1", { title: "New", category: "y" } as Partial<Article>),
      ).rejects.toBeInstanceOf(GeneralError);
    });

    it("bumps updatedAt when timestamps is true", async () => {
      const { client, app } = makeSetup();
      client.retrieve
        .mockResolvedValueOnce([{ id: "1", payload: { title: "Old", category: "x" } }])
        .mockResolvedValueOnce([{ id: "1", vector: [0.1, 0.2, 0.3] }]);
      await new TestRepoWithTimestamps(app).updateById("1", { title: "New", category: "y" } as Partial<Article>);
      const [, { points }] = (client.upsert as ReturnType<typeof vi.fn>).mock.calls[0] as [
        string,
        { points: Array<{ payload: Record<string, unknown> }> },
      ];
      expect(points[0].payload).toHaveProperty("updatedAt");
    });
  });

  describe("patchById", () => {
    it("merges the patch into the existing record", async () => {
      const { client, app } = makeSetup();
      client.retrieve
        .mockResolvedValueOnce([{ id: "1", payload: { title: "Old", category: "x" } }])
        .mockResolvedValueOnce([{ id: "1", vector: [0.1, 0.2, 0.3] }]);
      await new TestRepo(app).patchById("1", { title: "Patched" } as Partial<Article>);
      const [, { points }] = (client.upsert as ReturnType<typeof vi.fn>).mock.calls[0] as [
        string,
        { points: Array<{ payload: Record<string, unknown> }> },
      ];
      expect(points[0].payload).toEqual(expect.objectContaining({ title: "Patched", category: "x" }));
    });

    it("throws NotFound when the record does not exist", async () => {
      const { app } = makeSetup();
      await expect(new TestRepo(app).patchById("missing", { title: "X" } as Partial<Article>)).rejects.toBeInstanceOf(
        NotFound,
      );
    });

    it("falls back to a zero vector when the existing point has none", async () => {
      const { client, app } = makeSetup();
      client.retrieve
        .mockResolvedValueOnce([{ id: "1", payload: { title: "Old", category: "x" } }])
        .mockResolvedValueOnce([{ id: "1" }]);
      await new TestRepo(app).patchById("1", { title: "Patched" } as Partial<Article>);
      const [, { points }] = (client.upsert as ReturnType<typeof vi.fn>).mock.calls[0] as [
        string,
        { points: Array<{ vector: number[] }> },
      ];
      expect(points[0].vector).toEqual([0, 0, 0]);
    });

    it("bumps updatedAt when timestamps is true", async () => {
      const { client, app } = makeSetup();
      client.retrieve
        .mockResolvedValueOnce([{ id: "1", payload: { title: "Old", category: "x" } }])
        .mockResolvedValueOnce([{ id: "1", vector: [0.1, 0.2, 0.3] }]);
      await new TestRepoWithTimestamps(app).patchById("1", { title: "Patched" } as Partial<Article>);
      const [, { points }] = (client.upsert as ReturnType<typeof vi.fn>).mock.calls[0] as [
        string,
        { points: Array<{ payload: Record<string, unknown> }> },
      ];
      expect(points[0].payload).toHaveProperty("updatedAt");
    });

    it("wraps a driver error other than not-found", async () => {
      const { client, app } = makeSetup();
      client.retrieve.mockResolvedValueOnce([{ id: "1", payload: { title: "Old", category: "x" } }]);
      client.upsert.mockRejectedValue(new Error("connection reset"));
      await expect(new TestRepo(app).patchById("1", { title: "Patched" } as Partial<Article>)).rejects.toBeInstanceOf(
        GeneralError,
      );
    });
  });

  describe("deleteById", () => {
    it("retrieves then deletes the point by id", async () => {
      const { client, app } = makeSetup();
      client.retrieve.mockResolvedValue([{ id: "1", payload: { title: "Doc", category: "tech" } }]);
      const result = await new TestRepo(app).deleteById("1");
      expect(client.delete).toHaveBeenCalledWith("articles", { points: ["1"] });
      expect(result).toEqual({ id: "1", title: "Doc", category: "tech" });
    });

    it("throws NotFound when the record does not exist", async () => {
      const { app } = makeSetup();
      await expect(new TestRepo(app).deleteById("missing")).rejects.toBeInstanceOf(NotFound);
    });

    it("wraps a driver error other than not-found", async () => {
      const { client, app } = makeSetup();
      client.retrieve.mockResolvedValueOnce([{ id: "1", payload: { title: "Doc", category: "tech" } }]);
      client.delete.mockRejectedValue(new Error("connection reset"));
      await expect(new TestRepo(app).deleteById("1")).rejects.toBeInstanceOf(GeneralError);
    });
  });

  describe("count", () => {
    it("calls count with exact: true", async () => {
      const { client, app } = makeSetup();
      client.count.mockResolvedValue({ count: 7 });
      expect(await new TestRepo(app).count()).toBe(7);
      expect(client.count).toHaveBeenCalledWith("articles", expect.objectContaining({ exact: true }));
    });

    it("applies filter when params.where is provided", async () => {
      const { client, app } = makeSetup();
      client.count.mockResolvedValue({ count: 3 });
      await new TestRepo(app).count({ where: { category: "tech" } });
      expect(client.count).toHaveBeenCalledWith(
        "articles",
        expect.objectContaining({
          filter: { must: [{ key: "category", match: { value: "tech" } }] },
        }),
      );
    });

    it("wraps a driver error", async () => {
      const { client, app } = makeSetup();
      client.count.mockRejectedValue(new Error("connection reset"));
      await expect(new TestRepo(app).count()).rejects.toBeInstanceOf(GeneralError);
    });
  });

  describe("wrapError", () => {
    it("passes an already-typed MantleError through unchanged", async () => {
      const { client, app } = makeSetup();
      client.retrieve.mockRejectedValue(new BadRequest("already typed"));
      await expect(new TestRepo(app).findById("1")).rejects.toBeInstanceOf(BadRequest);
    });

    it("wraps Error instances as GeneralError", async () => {
      const { client, app } = makeSetup();
      client.retrieve.mockRejectedValue(new Error("timeout"));
      await expect(new TestRepo(app).findById("1")).rejects.toBeInstanceOf(GeneralError);
    });

    it("wraps non-Error throws as GeneralError", async () => {
      const { client, app } = makeSetup();
      client.retrieve.mockRejectedValue("string error");
      await expect(new TestRepo(app).findById("1")).rejects.toBeInstanceOf(GeneralError);
    });
  });

  describe("findPage", () => {
    it("traverses pages via the returned cursor, mapping Qdrant's next_page_offset", async () => {
      const { client, app } = makeSetup();
      const repo = new TestRepo(app);
      client.scroll.mockResolvedValueOnce({
        points: [{ id: "1", payload: { title: "A", category: "x" } }],
        next_page_offset: "point-2",
      });

      const page1 = await repo.findPage({ limit: 1 });
      expect(page1.data).toEqual([{ id: "1", title: "A", category: "x" }]);
      expect(page1.cursor).toBeDefined();
      expect(client.scroll).toHaveBeenCalledWith("articles", { limit: 1, with_payload: true });

      client.scroll.mockResolvedValueOnce({
        points: [{ id: "2", payload: { title: "B", category: "y" } }],
        next_page_offset: null,
      });
      const page2 = await repo.findPage({ limit: 1, cursor: page1.cursor });
      expect(page2.data[0].id).toBe("2");
      expect(page2.cursor).toBeUndefined();
      expect(client.scroll).toHaveBeenLastCalledWith("articles", { limit: 1, offset: "point-2", with_payload: true });
    });

    it("passes the where clause as a Qdrant filter and defaults the page size", async () => {
      const { client, app } = makeSetup();
      await new TestRepo(app).findPage({ where: { category: "tech" } });
      expect(client.scroll).toHaveBeenCalledWith(
        "articles",
        expect.objectContaining({
          limit: 100,
          filter: { must: [{ key: "category", match: { value: "tech" } }] },
        }),
      );
    });

    it("rejects skip with BadRequest", async () => {
      const { client, app } = makeSetup();
      await expect(new TestRepo(app).findPage({ skip: 5 })).rejects.toBeInstanceOf(BadRequest);
      expect(client.scroll).not.toHaveBeenCalled();
    });

    it("rejects sort with BadRequest", async () => {
      const { client, app } = makeSetup();
      await expect(new TestRepo(app).findPage({ sort: { title: "asc" } })).rejects.toBeInstanceOf(BadRequest);
      expect(client.scroll).not.toHaveBeenCalled();
    });

    it("rejects a malformed cursor with BadRequest before hitting Qdrant", async () => {
      const { client, app } = makeSetup();
      await expect(new TestRepo(app).findPage({ cursor: "garbage!!" })).rejects.toBeInstanceOf(BadRequest);
      expect(client.scroll).not.toHaveBeenCalled();
    });

    it("rejects a cursor that decodes to valid JSON of the wrong type", async () => {
      const { client, app } = makeSetup();
      const wrongTypeCursor = Buffer.from(JSON.stringify({ not: "a point offset" }), "utf8").toString("base64url");
      await expect(new TestRepo(app).findPage({ cursor: wrongTypeCursor })).rejects.toBeInstanceOf(BadRequest);
      expect(client.scroll).not.toHaveBeenCalled();
    });

    it("treats a missing payload as an empty object", async () => {
      const { client, app } = makeSetup();
      client.scroll.mockResolvedValueOnce({ points: [{ id: "1" }], next_page_offset: null });
      const page = await new TestRepo(app).findPage();
      expect(page.data).toEqual([{ id: "1" }]);
    });

    it("wraps a driver error", async () => {
      const { client, app } = makeSetup();
      client.scroll.mockRejectedValue(new Error("connection reset"));
      await expect(new TestRepo(app).findPage()).rejects.toBeInstanceOf(GeneralError);
    });
  });

  describe("describe()", () => {
    it("reports the exact operator set assertOperators accepts", () => {
      const { app } = makeSetup();
      const caps = new TestRepo(app).describe();
      expect(caps.adapter).toBe("@mantlejs/qdrant");
      expect(new Set(caps.operators)).toEqual(QDRANT_OPERATORS);
      expect(caps.pagination).toBe("both");
      expect(caps.fullTextSearch).toBe(false);
    });
  });

  describe("fieldMap", () => {
    it("translates data payload keys to payload keys on save", async () => {
      const { client, app } = makeSetup();
      await new TestRepoFieldMap(app).save({ id: "1", userName: "alice" });
      const [, { points }] = client.upsert.mock.calls[0] as [
        string,
        { points: Array<{ payload: Record<string, unknown> }> },
      ];
      expect(points[0]?.payload).toHaveProperty("user_name", "alice");
      expect(points[0]?.payload).not.toHaveProperty("userName");
    });

    it("translates payload keys back to entity field names on findById", async () => {
      const { client, app } = makeSetup();
      client.retrieve.mockResolvedValue([{ id: "1", payload: { user_name: "alice" } }]);
      const result = await new TestRepoFieldMap(app).findById("1");
      expect(result).toEqual({ id: "1", userName: "alice" });
    });

    it("translates a where clause field name for findSimilar", async () => {
      const { client, app } = makeSetup();
      await new TestRepoFieldMap(app).findSimilar([0.1], 5, { where: { userName: "alice" } });
      expect(client.search).toHaveBeenCalledWith(
        "accounts",
        expect.objectContaining({
          filter: { must: [{ key: "user_name", match: { value: "alice" } }] },
        }),
      );
    });

    it("translates the sort key used for order_by in findAll", async () => {
      const { client, app } = makeSetup();
      await new TestRepoFieldMap(app).findAll({ sort: { userName: "asc" }, limit: 10 });
      expect(client.scroll).toHaveBeenCalledWith(
        "accounts",
        expect.objectContaining({ order_by: { key: "user_name", direction: "asc" } }),
      );
    });

    it("does not remap idField into the payload", async () => {
      const { client, app } = makeSetup();
      await new TestRepoFieldMap(app).save({ id: "1", userName: "alice" });
      const [, { points }] = client.upsert.mock.calls[0] as [
        string,
        { points: Array<{ payload: Record<string, unknown> }> },
      ];
      expect(points[0]?.payload).not.toHaveProperty("id");
    });
  });
});
