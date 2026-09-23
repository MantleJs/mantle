import { describe, expect, it, vi } from "vitest";
import type { HookContext, Id } from "@mantlejs/mantle";
import { MemoryRepository } from "@mantlejs/memory";
import { embed } from "./embed.js";
import type { EmbeddingProvider } from "./embed.js";

interface Article extends Record<string, unknown> {
  id?: string;
  title: string;
  body: string;
}

/** Minimal VectorRepository<Article> double over MemoryRepository — records upsert calls, matching the shape @mantlejs/pinecone/qdrant/mongodb all share (upsert-by-id, replace semantics). */
class FakeVectorRepository extends MemoryRepository<Article> {
  readonly upsertCalls: Array<{ id: Id; vector: number[] }> = [];

  async findSimilar(): Promise<Array<Article & { _score: number }>> {
    return [];
  }

  async upsertVector(id: Id, vector: number[], data: Partial<Article>): Promise<Article> {
    this.upsertCalls.push({ id, vector });
    const existing = await this.findById(id);
    return existing ? this.patchById(id, data) : this.save({ ...data, id } as Partial<Article>);
  }

  async deleteVector(id: Id): Promise<Article> {
    return this.deleteById(id);
  }
}

function stubProvider(fn: (text: string) => number[] = (text) => [text.length, 0, 0]): EmbeddingProvider {
  return { dimensions: 3, embed: vi.fn(async (text: string) => fn(text)) };
}

function makeCtx(overrides: Partial<HookContext<Article>> = {}): HookContext<Article> {
  return {
    app: { get: vi.fn() } as unknown as HookContext<Article>["app"],
    service: {},
    path: "articles",
    method: "create",
    params: { provider: "rest" },
    ...overrides,
  } as HookContext<Article>;
}

describe("embed()", () => {
  it("embeds the joined field list and upserts under the record's id", async () => {
    const vectors = new FakeVectorRepository();
    const provider = stubProvider();
    const ctx = makeCtx({ result: { id: "a1", title: "Hello", body: "World" } });

    await embed({ vectors, provider, field: ["title", "body"] })(ctx);

    expect(provider.embed).toHaveBeenCalledWith("Hello\nWorld");
    expect(vectors.upsertCalls).toEqual([{ id: "a1", vector: [11, 0, 0] }]);
  });

  it("accepts a single field name (not wrapped in an array)", async () => {
    const vectors = new FakeVectorRepository();
    const provider = stubProvider();
    const ctx = makeCtx({ result: { id: "a1", title: "Hello", body: "World" } });

    await embed({ vectors, provider, field: "title" })(ctx);

    expect(provider.embed).toHaveBeenCalledWith("Hello");
  });

  it("accepts a function for full control over the extracted text", async () => {
    const vectors = new FakeVectorRepository();
    const provider = stubProvider();
    const ctx = makeCtx({ result: { id: "a1", title: "Hello", body: "World" } });

    await embed({ vectors, provider, field: (a) => `${a.title.toUpperCase()} :: ${a.body}` })(ctx);

    expect(provider.embed).toHaveBeenCalledWith("HELLO :: World");
  });

  it("is idempotent: re-running for the same source id replaces the vector rather than duplicating it", async () => {
    const vectors = new FakeVectorRepository();
    const provider = stubProvider();
    const hook = embed({ vectors, provider, field: ["title", "body"] });

    await hook(makeCtx({ result: { id: "a1", title: "v1", body: "..." } }));
    await hook(makeCtx({ method: "update", result: { id: "a1", title: "v2 is longer now", body: "..." } }));
    await hook(makeCtx({ method: "patch", result: { id: "a1", title: "v2 is longer now", body: "..." } }));

    expect(vectors.upsertCalls).toHaveLength(3); // the hook was invoked three times...
    const stored = await vectors.findById("a1");
    expect(stored).not.toBeNull(); // ...but only one record exists at that id, not three
    expect((await vectors.findAll()).filter((a) => a.id === "a1")).toHaveLength(1);
  });

  it("does not fail the primary operation when the embedding provider throws", async () => {
    const vectors = new FakeVectorRepository();
    const provider: EmbeddingProvider = { embed: vi.fn().mockRejectedValue(new Error("provider is down")) };
    const ctx = makeCtx({ result: { id: "a1", title: "Hello", body: "World" } });

    await expect(embed({ vectors, provider, field: ["title", "body"] })(ctx)).resolves.toBe(ctx);
    expect(vectors.upsertCalls).toHaveLength(0);
  });

  it("does not fail the primary operation when the vector upsert throws", async () => {
    const vectors = { upsertVector: vi.fn().mockRejectedValue(new Error("vector store is down")) } as unknown as FakeVectorRepository;
    const provider = stubProvider();
    const ctx = makeCtx({ result: { id: "a1", title: "Hello", body: "World" } });

    await expect(embed({ vectors, provider, field: ["title", "body"] })(ctx)).resolves.toBe(ctx);
  });

  it("calls onError with the failure instead of throwing", async () => {
    const vectors = new FakeVectorRepository();
    const failure = new Error("provider is down");
    const provider: EmbeddingProvider = { embed: vi.fn().mockRejectedValue(failure) };
    const onError = vi.fn();
    const ctx = makeCtx({ result: { id: "a1", title: "Hello", body: "World" } });

    await embed({ vectors, provider, field: ["title", "body"], onError })(ctx);

    expect(onError).toHaveBeenCalledWith(failure, { id: "a1", title: "Hello", body: "World" }, ctx);
  });

  it("falls back to app.get('logger') when no onError is given and a logger is configured", async () => {
    const vectors = new FakeVectorRepository();
    const provider: EmbeddingProvider = { embed: vi.fn().mockRejectedValue(new Error("provider is down")) };
    const logError = vi.fn();
    const ctx = makeCtx({ result: { id: "a1", title: "Hello", body: "World" } });
    (ctx.app.get as ReturnType<typeof vi.fn>).mockReturnValue({ error: logError });

    await embed({ vectors, provider, field: ["title", "body"] })(ctx);

    expect(logError).toHaveBeenCalledWith("embed() failed", expect.objectContaining({ path: "articles" }));
  });

  it("skips a find result (an array) — nothing embeddable there", async () => {
    const vectors = new FakeVectorRepository();
    const provider = stubProvider();
    const ctx = makeCtx({ method: "find", result: [{ id: "a1", title: "Hello", body: "World" }] });

    await embed({ vectors, provider, field: ["title", "body"] })(ctx);

    expect(provider.embed).not.toHaveBeenCalled();
  });

  it("skips a paginated find result", async () => {
    const vectors = new FakeVectorRepository();
    const provider = stubProvider();
    const ctx = makeCtx({
      method: "find",
      result: { data: [{ id: "a1", title: "Hello", body: "World" }], total: 1, limit: 10, skip: 0 },
    });

    await embed({ vectors, provider, field: ["title", "body"] })(ctx);

    expect(provider.embed).not.toHaveBeenCalled();
  });

  it("skips and reports when the written record has no id", async () => {
    const vectors = new FakeVectorRepository();
    const provider = stubProvider();
    const onError = vi.fn();
    const ctx = makeCtx({ result: { title: "Hello", body: "World" } });

    await embed({ vectors, provider, field: ["title", "body"], onError })(ctx);

    expect(provider.embed).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.any(Error), { title: "Hello", body: "World" }, ctx);
  });

  it("falls back to ctx.id when the result itself has no id field", async () => {
    const vectors = new FakeVectorRepository();
    const provider = stubProvider();
    const ctx = makeCtx({ method: "patch", id: "a1", result: { title: "Hello", body: "World" } });

    await embed({ vectors, provider, field: ["title", "body"] })(ctx);

    expect(vectors.upsertCalls).toEqual([{ id: "a1", vector: [11, 0, 0] }]);
  });

  it("returns the context unchanged on success", async () => {
    const vectors = new FakeVectorRepository();
    const provider = stubProvider();
    const ctx = makeCtx({ result: { id: "a1", title: "Hello", body: "World" } });

    const result = await embed({ vectors, provider, field: ["title", "body"] })(ctx);

    expect(result).toBe(ctx);
  });
});
