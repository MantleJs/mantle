import { describe, expect, it } from "vitest";
import { NotFound, type Id } from "@mantlejs/mantle";
import { MemoryRepository } from "@mantlejs/memory";
import { ArticlesService } from "./articles-service.js";
import type { Article } from "../entities/article.js";
import type { ActivityLog } from "../entities/activity-log.js";
import type { Embedder } from "../embedder.js";

/** Minimal `VectorRepository<Article>` double over a `MemoryRepository` — records upsert calls. */
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

const stubEmbedder: Embedder = {
  dimensions: 3,
  async embed(text: string) {
    return [text.length, 0, 0];
  },
};

function makeService() {
  const articles = new MemoryRepository<Article>();
  const activity = new MemoryRepository<ActivityLog>();
  const vectors = new FakeVectorRepository();
  const service = new ArticlesService(articles, activity, vectors, stubEmbedder);
  return { service, articles, activity, vectors };
}

describe("ArticlesService (multi-repository composition)", () => {
  it("writes the article, an activity-log entry, and an embedding on create", async () => {
    const { service, activity, vectors } = makeService();

    const article = await service.create(
      { title: "Onboarding", body: "Welcome to the team" },
      { user: { id: 7 } },
    );

    expect(article.title).toBe("Onboarding");

    const logEntries = await activity.findAll();
    expect(logEntries).toHaveLength(1);
    expect(logEntries[0]).toMatchObject({ entityType: "article", entityId: article.id, action: "created", actorId: 7 });

    expect(vectors.upsertCalls).toHaveLength(1);
    expect(vectors.upsertCalls[0]?.id).toBe(article.id);
  });

  it("logs an actorId of null when the call has no authenticated user", async () => {
    const { service, activity } = makeService();
    await service.create({ title: "Anon post", body: "..." });
    const [entry] = await activity.findAll();
    expect(entry?.actorId).toBeNull();
  });

  it("re-embeds and logs an activity entry on update and patch", async () => {
    const { service, activity, vectors } = makeService();
    const article = await service.create({ title: "v1", body: "..." });

    await service.update(article.id, { title: "v2", body: "..." }, { user: { id: 1 } });
    await service.patch(article.id, { title: "v3" }, { user: { id: 1 } });

    const actions = (await activity.findAll()).map((e) => e.action);
    expect(actions).toEqual(["created", "updated", "updated"]);
    expect(vectors.upsertCalls).toHaveLength(3);
  });

  it("logs a removal but does not re-embed", async () => {
    const { service, activity, vectors } = makeService();
    const article = await service.create({ title: "v1", body: "..." });
    vectors.upsertCalls.length = 0;

    await service.remove(article.id, { user: { id: 1 } });

    const actions = (await activity.findAll()).map((e) => e.action);
    expect(actions).toEqual(["created", "removed"]);
    expect(vectors.upsertCalls).toHaveLength(0);
  });

  it("get() throws NotFound for a missing article", async () => {
    const { service } = makeService();
    await expect(service.get(999)).rejects.toThrow(NotFound);
  });

  it("find() passes params.query straight through as the where clause", async () => {
    const { service, articles } = makeService();
    await articles.save({ title: "A", body: "...", authorId: 1 });
    await articles.save({ title: "B", body: "...", authorId: 2 });

    const results = await service.find({ query: { authorId: 2 } });
    expect(results).toHaveLength(1);
    expect(results[0]?.title).toBe("B");
  });
});
