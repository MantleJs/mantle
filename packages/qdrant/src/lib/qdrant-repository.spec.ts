import { describe, expect, it, vi } from "vitest";
import type { MantleApplication } from "@mantlejs/mantle";
import { GeneralError, NotFound } from "@mantlejs/mantle";

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
      client.search.mockResolvedValue([
        { id: "1", score: 0.9, payload: { title: "Doc", category: "tech" } },
      ]);
      const result = await new TestRepo(app).findSimilar([0.1, 0.2, 0.3], 5);
      expect(result).toEqual([{ id: "1", title: "Doc", category: "tech", _score: 0.9 }]);
    });

    it("wraps errors as GeneralError", async () => {
      const { client, app } = makeSetup();
      client.search.mockRejectedValue(new Error("network error"));
      await expect(new TestRepo(app).findSimilar([0.1], 5)).rejects.toBeInstanceOf(GeneralError);
    });
  });

  describe("upsertVector", () => {
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
      expect(client.scroll).toHaveBeenCalledWith(
        "articles",
        expect.objectContaining({ limit: 15 }),
      );
    });

    it("paginates through all records when no limit is provided", async () => {
      const { client, app } = makeSetup();
      client.scroll
        .mockResolvedValueOnce({ points: [{ id: "1", payload: { title: "A", category: "x" } }], next_page_offset: "tok" })
        .mockResolvedValueOnce({ points: [{ id: "2", payload: { title: "B", category: "y" } }], next_page_offset: null });
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
      await expect(
        new TestRepo(app).patchById("missing", { title: "X" } as Partial<Article>),
      ).rejects.toBeInstanceOf(NotFound);
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
  });

  describe("wrapError", () => {
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

  describe("describe()", () => {
    it("reports the exact operator set assertOperators accepts", () => {
      const { app } = makeSetup();
      const caps = new TestRepo(app).describe();
      expect(caps.adapter).toBe("@mantlejs/qdrant");
      expect(new Set(caps.operators)).toEqual(QDRANT_OPERATORS);
      expect(caps.pagination).toBe("offset");
      expect(caps.fullTextSearch).toBe(false);
    });
  });
});
