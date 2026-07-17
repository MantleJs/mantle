import { describe, expect, it, vi } from "vitest";
import type { MantleApplication } from "@mantlejs/mantle";
import { BadRequest, GeneralError, NotFound } from "@mantlejs/mantle";

vi.mock("@pinecone-database/pinecone", () => ({
  Pinecone: vi.fn(),
  Index: vi.fn(),
}));

// Dynamic import AFTER the mock so the module uses the mocked Pinecone
const { PineconeRepository } = await import("./pinecone-repository.js");
const { PINECONE_OPERATORS } = await import("./pinecone-filter.js");

interface Article extends Record<string, unknown> {
  id: string;
  title: string;
  category: string;
}

// ─── Mock helpers ────────────────────────────────────────────────────────────

function makeIndex() {
  return {
    upsert: vi.fn().mockResolvedValue(undefined),
    fetch: vi.fn().mockResolvedValue({ records: {} }),
    query: vi.fn().mockResolvedValue({ matches: [] }),
    deleteOne: vi.fn().mockResolvedValue(undefined),
    listPaginated: vi.fn().mockResolvedValue({ vectors: [], pagination: undefined }),
    describeIndexStats: vi.fn().mockResolvedValue({ namespaces: {}, totalRecordCount: 0 }),
  };
}

function makeSetup() {
  const idx = makeIndex();
  const client = { index: vi.fn().mockReturnValue(idx) };
  const app = {
    get: vi.fn().mockReturnValue(client),
    set: vi.fn().mockReturnThis(),
  } as unknown as MantleApplication;
  return { idx, client, app };
}

// ─── Concrete test repositories ───────────────────────────────────────────────

class TestRepo extends PineconeRepository<Article> {
  readonly indexName = "articles-index";
  readonly namespace = "test-ns";
  readonly vectorDimension = 3;
  override readonly timestamps = false;
}

class TestRepoWithTimestamps extends PineconeRepository<Article> {
  readonly indexName = "articles-index";
  readonly namespace = "test-ns";
  readonly vectorDimension = 3;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("PineconeRepository", () => {
  describe("index getter (lazy init)", () => {
    it("calls client.index() with indexName and namespace on first use", async () => {
      const { idx, client, app } = makeSetup();
      const repo = new TestRepo(app);
      idx.fetch.mockResolvedValue({ records: {} });
      await repo.findById("1");
      expect(client.index).toHaveBeenCalledWith({ name: "articles-index", namespace: "test-ns" });
    });

    it("only calls client.index() once across multiple operations", async () => {
      const { idx, client, app } = makeSetup();
      const repo = new TestRepo(app);
      idx.fetch.mockResolvedValue({ records: {} });
      await repo.findById("1");
      await repo.findById("2");
      expect(client.index).toHaveBeenCalledTimes(1);
    });
  });

  describe("findSimilar", () => {
    it("queries with vector, topK, and includeMetadata", async () => {
      const { idx, app } = makeSetup();
      idx.query.mockResolvedValue({ matches: [] });
      await new TestRepo(app).findSimilar([0.1, 0.2, 0.3], 5);
      expect(idx.query).toHaveBeenCalledWith(
        expect.objectContaining({ vector: [0.1, 0.2, 0.3], topK: 5, includeMetadata: true }),
      );
    });

    it("applies a Pinecone filter when params.where is provided", async () => {
      const { idx, app } = makeSetup();
      idx.query.mockResolvedValue({ matches: [] });
      await new TestRepo(app).findSimilar([0.1, 0.2, 0.3], 5, { where: { category: "tech" } });
      expect(idx.query).toHaveBeenCalledWith(
        expect.objectContaining({ filter: { category: { $eq: "tech" } } }),
      );
    });

    it("maps matched records to domain entities with the match score as _score", async () => {
      const { idx, app } = makeSetup();
      idx.query.mockResolvedValue({
        matches: [{ id: "1", score: 0.9, metadata: { title: "Doc", category: "tech" } }],
      });
      const result = await new TestRepo(app).findSimilar([0.1], 5);
      expect(result).toEqual([{ id: "1", title: "Doc", category: "tech", _score: 0.9 }]);
    });

    it("defaults _score to 0 when Pinecone omits the score", async () => {
      const { idx, app } = makeSetup();
      idx.query.mockResolvedValue({ matches: [{ id: "1", metadata: { title: "Doc" } }] });
      const result = await new TestRepo(app).findSimilar([0.1], 5);
      expect(result[0]?._score).toBe(0);
    });

    it("wraps errors as GeneralError", async () => {
      const { idx, app } = makeSetup();
      idx.query.mockRejectedValue(new Error("network error"));
      await expect(new TestRepo(app).findSimilar([0.1], 5)).rejects.toBeInstanceOf(GeneralError);
    });
  });

  describe("upsertVector", () => {
    it("upserts the record with the given vector", async () => {
      const { idx, app } = makeSetup();
      await new TestRepo(app).upsertVector("1", [0.1, 0.2, 0.3], { title: "Doc", category: "tech" });
      expect(idx.upsert).toHaveBeenCalledWith({
        records: [{ id: "1", values: [0.1, 0.2, 0.3], metadata: { title: "Doc", category: "tech" } }],
      });
    });

    it("returns the entity with the id and provided data", async () => {
      const { idx, app } = makeSetup();
      idx.upsert.mockResolvedValue(undefined);
      const result = await new TestRepo(app).upsertVector("1", [0.1], { title: "Doc", category: "tech" });
      expect(result).toEqual({ id: "1", title: "Doc", category: "tech" });
    });
  });

  describe("deleteVector", () => {
    it("delegates to deleteById and returns the deleted record", async () => {
      const { idx, app } = makeSetup();
      idx.fetch.mockResolvedValue({
        records: { "1": { id: "1", metadata: { title: "Doc", category: "tech" } } },
      });
      const result = await new TestRepo(app).deleteVector("1");
      expect(idx.deleteOne).toHaveBeenCalledWith({ id: "1" });
      expect(result).toEqual({ id: "1", title: "Doc", category: "tech" });
    });
  });

  describe("findAll", () => {
    it("uses listPaginated + fetch when no filter is provided", async () => {
      const { idx, app } = makeSetup();
      idx.listPaginated.mockResolvedValue({ vectors: [{ id: "1" }, { id: "2" }], pagination: undefined });
      idx.fetch.mockResolvedValue({
        records: {
          "1": { id: "1", metadata: { title: "A", category: "x" } },
          "2": { id: "2", metadata: { title: "B", category: "y" } },
        },
      });
      const result = await new TestRepo(app).findAll();
      expect(idx.listPaginated).toHaveBeenCalled();
      expect(idx.fetch).toHaveBeenCalledWith({ ids: ["1", "2"] });
      expect(result).toHaveLength(2);
    });

    it("paginates through all IDs when pagination token is returned", async () => {
      const { idx, app } = makeSetup();
      idx.listPaginated
        .mockResolvedValueOnce({ vectors: [{ id: "1" }], pagination: { next: "tok" } })
        .mockResolvedValueOnce({ vectors: [{ id: "2" }], pagination: undefined });
      idx.fetch.mockResolvedValue({ records: {} });
      await new TestRepo(app).findAll();
      expect(idx.listPaginated).toHaveBeenCalledTimes(2);
    });

    it("applies skip and limit to the ID list", async () => {
      const { idx, app } = makeSetup();
      idx.listPaginated.mockResolvedValue({
        vectors: [{ id: "1" }, { id: "2" }, { id: "3" }],
        pagination: undefined,
      });
      idx.fetch.mockResolvedValue({ records: {} });
      await new TestRepo(app).findAll({ skip: 1, limit: 1 });
      expect(idx.fetch).toHaveBeenCalledWith({ ids: ["2"] });
    });

    it("uses query with zero vector when params.where is provided", async () => {
      const { idx, app } = makeSetup();
      idx.query.mockResolvedValue({ matches: [] });
      await new TestRepo(app).findAll({ where: { category: "tech" } });
      expect(idx.query).toHaveBeenCalledWith(
        expect.objectContaining({
          vector: [0, 0, 0],
          filter: { category: { $eq: "tech" } },
          includeMetadata: true,
        }),
      );
    });

    it("returns empty array when no records exist", async () => {
      const { idx, app } = makeSetup();
      idx.listPaginated.mockResolvedValue({ vectors: [], pagination: undefined });
      expect(await new TestRepo(app).findAll()).toEqual([]);
    });
  });

  describe("findById", () => {
    it("fetches the record by id", async () => {
      const { idx, app } = makeSetup();
      idx.fetch.mockResolvedValue({
        records: { "42": { id: "42", metadata: { title: "Doc", category: "tech" } } },
      });
      const result = await new TestRepo(app).findById("42");
      expect(idx.fetch).toHaveBeenCalledWith({ ids: ["42"] });
      expect(result).toEqual({ id: "42", title: "Doc", category: "tech" });
    });

    it("returns null when the record is not found", async () => {
      const { app } = makeSetup();
      expect(await new TestRepo(app).findById("missing")).toBeNull();
    });
  });

  describe("save", () => {
    it("upserts with a zero vector placeholder", async () => {
      const { idx, app } = makeSetup();
      await new TestRepo(app).save({ id: "1", title: "Doc", category: "tech" } as Partial<Article>);
      expect(idx.upsert).toHaveBeenCalledWith({
        records: [{ id: "1", values: [0, 0, 0], metadata: expect.any(Object) }],
      });
    });

    it("stores the record fields as metadata (excluding id)", async () => {
      const { idx, app } = makeSetup();
      await new TestRepo(app).save({ id: "1", title: "Doc", category: "tech" } as Partial<Article>);
      const [{ records }] = (idx.upsert as ReturnType<typeof vi.fn>).mock.calls[0] as [
        { records: Array<{ metadata: Record<string, unknown> }> },
      ];
      expect(records[0].metadata).toEqual({ title: "Doc", category: "tech" });
      expect(records[0].metadata).not.toHaveProperty("id");
    });

    it("generates a uuid when no id is provided", async () => {
      const { idx, app } = makeSetup();
      await new TestRepo(app).save({ title: "Doc", category: "tech" } as Partial<Article>);
      const [{ records }] = (idx.upsert as ReturnType<typeof vi.fn>).mock.calls[0] as [
        { records: Array<{ id: string }> },
      ];
      expect(records[0].id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it("adds createdAt and updatedAt when timestamps is true", async () => {
      const { idx, app } = makeSetup();
      await new TestRepoWithTimestamps(app).save({ id: "1", title: "Doc", category: "tech" } as Partial<Article>);
      const [{ records }] = (idx.upsert as ReturnType<typeof vi.fn>).mock.calls[0] as [
        { records: Array<{ metadata: Record<string, unknown> }> },
      ];
      expect(records[0].metadata).toHaveProperty("createdAt");
      expect(records[0].metadata).toHaveProperty("updatedAt");
    });

    it("does not add timestamps when timestamps is false", async () => {
      const { idx, app } = makeSetup();
      await new TestRepo(app).save({ id: "1", title: "Doc", category: "tech" } as Partial<Article>);
      const [{ records }] = (idx.upsert as ReturnType<typeof vi.fn>).mock.calls[0] as [
        { records: Array<{ metadata: Record<string, unknown> }> },
      ];
      expect(records[0].metadata).not.toHaveProperty("createdAt");
    });
  });

  describe("updateById", () => {
    it("replaces the record and preserves existing vector values", async () => {
      const { idx, app } = makeSetup();
      idx.fetch
        .mockResolvedValueOnce({ records: { "1": { id: "1", values: [0.5, 0.6, 0.7], metadata: { title: "Old", category: "x" } } } })
        .mockResolvedValueOnce({ records: { "1": { id: "1", values: [0.5, 0.6, 0.7], metadata: {} } } });
      await new TestRepo(app).updateById("1", { title: "New", category: "y" } as Partial<Article>);
      const [{ records }] = (idx.upsert as ReturnType<typeof vi.fn>).mock.calls[0] as [
        { records: Array<{ id: string; values: number[] }> },
      ];
      expect(records[0].values).toEqual([0.5, 0.6, 0.7]);
    });

    it("throws NotFound when the record does not exist", async () => {
      const { app } = makeSetup();
      await expect(new TestRepo(app).updateById("missing", { title: "X", category: "y" } as Partial<Article>)).rejects.toBeInstanceOf(
        NotFound,
      );
    });
  });

  describe("patchById", () => {
    it("merges the patch into the existing record", async () => {
      const { idx, app } = makeSetup();
      idx.fetch
        .mockResolvedValueOnce({ records: { "1": { id: "1", values: [0.1], metadata: { title: "Old", category: "x" } } } })
        .mockResolvedValueOnce({ records: { "1": { id: "1", values: [0.1], metadata: {} } } });
      await new TestRepo(app).patchById("1", { title: "Patched" } as Partial<Article>);
      const [{ records }] = (idx.upsert as ReturnType<typeof vi.fn>).mock.calls[0] as [
        { records: Array<{ metadata: Record<string, unknown> }> },
      ];
      expect(records[0].metadata).toEqual(expect.objectContaining({ title: "Patched", category: "x" }));
    });

    it("throws NotFound when the record does not exist", async () => {
      const { app } = makeSetup();
      await expect(new TestRepo(app).patchById("missing", { title: "X" } as Partial<Article>)).rejects.toBeInstanceOf(
        NotFound,
      );
    });
  });

  describe("deleteById", () => {
    it("fetches the record then calls deleteOne", async () => {
      const { idx, app } = makeSetup();
      idx.fetch.mockResolvedValue({
        records: { "1": { id: "1", metadata: { title: "Doc", category: "tech" } } },
      });
      const result = await new TestRepo(app).deleteById("1");
      expect(idx.deleteOne).toHaveBeenCalledWith({ id: "1" });
      expect(result).toEqual({ id: "1", title: "Doc", category: "tech" });
    });

    it("throws NotFound when the record does not exist", async () => {
      const { app } = makeSetup();
      await expect(new TestRepo(app).deleteById("missing")).rejects.toBeInstanceOf(NotFound);
    });
  });

  describe("count", () => {
    it("returns namespace record count from describeIndexStats when no filter", async () => {
      const { idx, app } = makeSetup();
      idx.describeIndexStats.mockResolvedValue({
        namespaces: { "test-ns": { recordCount: 42 } },
        totalRecordCount: 100,
      });
      expect(await new TestRepo(app).count()).toBe(42);
    });

    it("falls back to totalRecordCount when namespace is not in stats", async () => {
      const { idx, app } = makeSetup();
      idx.describeIndexStats.mockResolvedValue({ namespaces: {}, totalRecordCount: 5 });
      expect(await new TestRepo(app).count()).toBe(5);
    });

    it("counts results from findAll when params.where is provided", async () => {
      const { idx, app } = makeSetup();
      idx.query.mockResolvedValue({
        matches: [
          { id: "1", metadata: { title: "A", category: "tech" } },
          { id: "2", metadata: { title: "B", category: "tech" } },
        ],
      });
      expect(await new TestRepo(app).count({ where: { category: "tech" } })).toBe(2);
    });
  });

  describe("wrapError", () => {
    it("wraps Error instances as GeneralError", async () => {
      const { idx, app } = makeSetup();
      idx.fetch.mockRejectedValue(new Error("network error"));
      await expect(new TestRepo(app).findById("1")).rejects.toBeInstanceOf(GeneralError);
    });

    it("wraps non-Error throws as GeneralError", async () => {
      const { idx, app } = makeSetup();
      idx.fetch.mockRejectedValue("string error");
      await expect(new TestRepo(app).findById("1")).rejects.toBeInstanceOf(GeneralError);
    });
  });

  describe("findPage", () => {
    it("traverses pages via Pinecone's paginationToken as the cursor", async () => {
      const { idx, app } = makeSetup();
      const repo = new TestRepo(app);
      idx.listPaginated.mockResolvedValueOnce({ vectors: [{ id: "1" }], pagination: { next: "tok-2" } });
      idx.fetch.mockResolvedValueOnce({ records: { "1": { id: "1", metadata: { title: "A" } } } });

      const page1 = await repo.findPage({ limit: 1 });
      expect(page1.data).toEqual([{ id: "1", title: "A" }]);
      expect(page1.cursor).toBe("tok-2");
      expect(idx.listPaginated).toHaveBeenCalledWith({ limit: 1 });

      idx.listPaginated.mockResolvedValueOnce({ vectors: [{ id: "2" }], pagination: undefined });
      idx.fetch.mockResolvedValueOnce({ records: { "2": { id: "2", metadata: { title: "B" } } } });
      const page2 = await repo.findPage({ limit: 1, cursor: page1.cursor });
      expect(page2.data[0].id).toBe("2");
      expect(page2.cursor).toBeUndefined();
      expect(idx.listPaginated).toHaveBeenLastCalledWith({ limit: 1, paginationToken: "tok-2" });
    });

    it("defaults the page size and returns an empty page without fetching", async () => {
      const { idx, app } = makeSetup();
      idx.listPaginated.mockResolvedValue({ vectors: [], pagination: undefined });
      const page = await new TestRepo(app).findPage();
      expect(page).toEqual({ data: [], cursor: undefined });
      expect(idx.listPaginated).toHaveBeenCalledWith({ limit: 100 });
      expect(idx.fetch).not.toHaveBeenCalled();
    });

    it("rejects where with BadRequest — the list API cannot filter", async () => {
      const { idx, app } = makeSetup();
      await expect(new TestRepo(app).findPage({ where: { category: "tech" } })).rejects.toBeInstanceOf(BadRequest);
      expect(idx.listPaginated).not.toHaveBeenCalled();
    });

    it("rejects skip with BadRequest", async () => {
      const { idx, app } = makeSetup();
      await expect(new TestRepo(app).findPage({ skip: 3 })).rejects.toBeInstanceOf(BadRequest);
      expect(idx.listPaginated).not.toHaveBeenCalled();
    });

    it("rejects sort with BadRequest", async () => {
      const { idx, app } = makeSetup();
      await expect(new TestRepo(app).findPage({ sort: { title: "asc" } })).rejects.toBeInstanceOf(BadRequest);
      expect(idx.listPaginated).not.toHaveBeenCalled();
    });
  });

  describe("describe()", () => {
    it("reports the exact operator set assertOperators accepts", () => {
      const { app } = makeSetup();
      const caps = new TestRepo(app).describe();
      expect(caps.adapter).toBe("@mantlejs/pinecone");
      expect(new Set(caps.operators)).toEqual(PINECONE_OPERATORS);
      expect(caps.pagination).toBe("both");
      expect(caps.fullTextSearch).toBe(false);
    });
  });
});
