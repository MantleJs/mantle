import { describe, expect, it } from "vitest";
import { NotFound } from "@mantlejs/mantle";
import { MemoryRepository } from "@mantlejs/memory";
import { ArticlesService } from "./articles-service.js";
import type { Article } from "../entities/article.js";
import type { ActivityLog } from "../entities/activity-log.js";

function makeService() {
  const articles = new MemoryRepository<Article>();
  const activity = new MemoryRepository<ActivityLog>();
  const service = new ArticlesService(articles, activity);
  return { service, articles, activity };
}

describe("ArticlesService (multi-repository composition)", () => {
  it("writes the article and an activity-log entry on create", async () => {
    const { service, activity } = makeService();

    const article = await service.create(
      { title: "Onboarding", body: "Welcome to the team" },
      { user: { id: 7 } },
    );

    expect(article.title).toBe("Onboarding");

    const logEntries = await activity.findAll();
    expect(logEntries).toHaveLength(1);
    expect(logEntries[0]).toMatchObject({ entityType: "article", entityId: article.id, action: "created", actorId: 7 });
  });

  it("logs an actorId of null when the call has no authenticated user", async () => {
    const { service, activity } = makeService();
    await service.create({ title: "Anon post", body: "..." });
    const [entry] = await activity.findAll();
    expect(entry?.actorId).toBeNull();
  });

  it("logs an activity entry on update and patch", async () => {
    const { service, activity } = makeService();
    const article = await service.create({ title: "v1", body: "..." });

    await service.update(article.id, { title: "v2", body: "..." }, { user: { id: 1 } });
    await service.patch(article.id, { title: "v3" }, { user: { id: 1 } });

    const actions = (await activity.findAll()).map((e) => e.action);
    expect(actions).toEqual(["created", "updated", "updated"]);
  });

  it("logs a removal", async () => {
    const { service, activity } = makeService();
    const article = await service.create({ title: "v1", body: "..." });

    await service.remove(article.id, { user: { id: 1 } });

    const actions = (await activity.findAll()).map((e) => e.action);
    expect(actions).toEqual(["created", "removed"]);
  });

  it("get() throws NotFound for a missing article", async () => {
    const { service } = makeService();
    await expect(service.get(999)).rejects.toThrow(NotFound);
  });

  it("find() passes plain query fields through as the where clause", async () => {
    const { service, articles } = makeService();
    await articles.save({ title: "A", body: "...", authorId: 1 });
    await articles.save({ title: "B", body: "...", authorId: 2 });

    const results = await service.find({ query: { authorId: 2 } });
    expect(results).toHaveLength(1);
    expect(results[0]?.title).toBe("B");
  });

  it("find() applies $sort instead of treating it as a where filter", async () => {
    const { service, articles } = makeService();
    await articles.save({ title: "A", body: "..." });
    await articles.save({ title: "B", body: "..." });

    const results = await service.find({ query: { $sort: { title: "desc" } } });
    expect(results.map((a) => a.title)).toEqual(["B", "A"]);
  });

  it("find() applies $limit and $skip", async () => {
    const { service, articles } = makeService();
    await articles.save({ title: "A", body: "..." });
    await articles.save({ title: "B", body: "..." });
    await articles.save({ title: "C", body: "..." });

    const results = await service.find({ query: { $sort: { title: "asc" }, $limit: 1, $skip: 1 } });
    expect(results.map((a) => a.title)).toEqual(["B"]);
  });
});
