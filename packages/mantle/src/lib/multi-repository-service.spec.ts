import { describe, expect, it } from "vitest";
import { mantle } from "./mantle.js";
import type { HookContext, Id, QueryParams, Repository, Service, ServiceParams } from "./types.js";
import { Conflict, NotFound } from "./errors.js";

interface Article {
  id: Id;
  title: string;
  body: string;
}

interface ActivityEntry {
  id: Id;
  articleId: Id;
  action: string;
}

/**
 * Minimal in-memory `Repository<T>` — a local stand-in for `@mantlejs/memory`'s
 * `MemoryRepository`. `packages/mantle` depends on nothing, so the fixture is
 * self-contained rather than importing the real adapter.
 */
class InMemoryRepository<T extends { id: Id }> implements Repository<T> {
  private readonly rows: T[] = [];
  private nextId = 1;

  constructor(private readonly onSave?: (data: Partial<T>) => void) {}

  async findAll(params?: QueryParams): Promise<T[]> {
    const where = params?.where ?? {};
    return this.rows.filter((row) => Object.entries(where).every(([key, value]) => (row as never)[key] === value));
  }

  async findById(id: Id): Promise<T | null> {
    return this.rows.find((row) => row.id === id) ?? null;
  }

  async save(data: Partial<T>): Promise<T> {
    this.onSave?.(data);
    const row = { ...data, id: this.nextId++ } as T;
    this.rows.push(row);
    return row;
  }

  async saveAll(data: Partial<T>[]): Promise<T[]> {
    const rows: T[] = [];
    for (const entry of data) rows.push(await this.save(entry));
    return rows;
  }

  async updateById(id: Id, data: Partial<T>): Promise<T> {
    const row = await this.findById(id);
    if (!row) throw new NotFound(`No record found for id '${String(id)}'`);
    Object.assign(row, data);
    return row;
  }

  async patchById(id: Id, data: Partial<T>): Promise<T> {
    return this.updateById(id, data);
  }

  async deleteById(id: Id): Promise<T> {
    const index = this.rows.findIndex((row) => row.id === id);
    if (index === -1) throw new NotFound(`No record found for id '${String(id)}'`);
    return this.rows.splice(index, 1)[0];
  }

  async count(params?: QueryParams): Promise<number> {
    return (await this.findAll(params)).length;
  }
}

/**
 * A custom `Service<T>` composed over two repositories — the pattern this spec verifies.
 * `create` writes the article then an activity entry; the two writes are not atomic.
 */
class ArticleService implements Service<Article> {
  constructor(
    private readonly articles: Repository<Article>,
    private readonly activity: Repository<ActivityEntry>,
  ) {}

  async find(params?: ServiceParams): Promise<Article[]> {
    return this.articles.findAll({ where: params?.query as Record<string, unknown> });
  }

  async get(id: Id): Promise<Article> {
    const article = await this.articles.findById(id);
    if (!article) throw new NotFound(`No article found for id '${String(id)}'`);
    return article;
  }

  async create(data: Partial<Article>): Promise<Article> {
    const article = await this.articles.save(data);
    await this.activity.save({ articleId: article.id, action: "created" });
    return article;
  }

  async update(id: Id, data: Partial<Article>): Promise<Article> {
    return this.articles.updateById(id, data);
  }

  async patch(id: Id, data: Partial<Article>): Promise<Article> {
    return this.articles.patchById(id, data);
  }

  async remove(id: Id): Promise<Article> {
    return this.articles.deleteById(id);
  }
}

describe("Multi-repository service composition", () => {
  it("writes to both repositories on create, runs hooks, and emits 'created' — same as a RepositoryService", async () => {
    const articles = new InMemoryRepository<Article>();
    const activity = new InMemoryRepository<ActivityEntry>();
    const app = mantle();
    app.use("articles", new ArticleService(articles, activity));

    const hookOrder: string[] = [];
    app.service<Article>("articles").hooks({
      before: {
        create: [
          (ctx: HookContext<Article>) => {
            hookOrder.push("before.create");
            return ctx;
          },
        ],
      },
    });

    const events: unknown[] = [];
    app.on("service:event", (...args) => events.push(args));

    const article = await app.service<Article>("articles").create({ title: "Hello", body: "World" });

    expect(hookOrder).toEqual(["before.create"]);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(["articles", "created", expect.objectContaining({ title: "Hello" }), expect.any(Object)]);

    await expect(articles.findById(article.id)).resolves.toEqual(article);
    const activityEntries = await activity.findAll();
    expect(activityEntries).toEqual([{ id: 1, articleId: article.id, action: "created" }]);
  });

  it("delegates find/get to the primary repository", async () => {
    const articles = new InMemoryRepository<Article>();
    const activity = new InMemoryRepository<ActivityEntry>();
    const app = mantle();
    app.use("articles", new ArticleService(articles, activity));

    const created = await app.service<Article>("articles").create({ title: "A", body: "B" });

    await expect(app.service<Article>("articles").find()).resolves.toEqual([created]);
    await expect(app.service<Article>("articles").get(created.id)).resolves.toEqual(created);
    await expect(app.service<Article>("articles").get(999)).rejects.toBeInstanceOf(NotFound);
  });

  it("propagates a Conflict thrown by the second repository untouched — cross-repo writes are not atomic", async () => {
    const articles = new InMemoryRepository<Article>();
    const activity = new InMemoryRepository<ActivityEntry>();
    activity.save = async () => {
      throw new Conflict("Activity log unavailable");
    };
    const app = mantle();
    app.use("articles", new ArticleService(articles, activity));

    await expect(app.service<Article>("articles").create({ title: "Hello", body: "World" })).rejects.toBeInstanceOf(
      Conflict,
    );

    // The article write already committed — the failure downstream did not roll it back.
    const saved = await articles.findAll();
    expect(saved).toHaveLength(1);
  });
});
