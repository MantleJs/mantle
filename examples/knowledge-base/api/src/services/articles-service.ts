import type { Id, Repository, Service, ServiceParams, VectorRepository } from "@mantlejs/mantle";
import { NotFound } from "@mantlejs/mantle";
import type { Article } from "../entities/article.js";
import type { ActivityLog } from "../entities/activity-log.js";
import type { Embedder } from "../embedder.js";

/**
 * The multi-repository showcase (see "Services with multiple repositories" in the root
 * README): composes the article table with an activity-log repository and a vector
 * repository over that same table, instead of forcing three collections through one
 * `RepositoryService`. Writes are not atomic — an activity-log or embedding failure after
 * a successful article write is not rolled back, same as `app.batch()`.
 */
export class ArticlesService implements Service<Article> {
  constructor(
    private readonly articles: Repository<Article>,
    private readonly activity: Repository<ActivityLog>,
    private readonly vectors: VectorRepository<Article>,
    private readonly embedder: Embedder,
  ) {}

  async find(params?: ServiceParams): Promise<Article[]> {
    return this.articles.findAll({ where: params?.query });
  }

  async get(id: Id): Promise<Article> {
    const article = await this.articles.findById(id);
    if (!article) throw new NotFound(`No article found for id '${String(id)}'`);
    return article;
  }

  async create(data: Partial<Article>, params?: ServiceParams): Promise<Article> {
    const article = await this.articles.save(data);
    await this.logActivity(article.id, "created", params);
    await this.reembed(article);
    return article;
  }

  async update(id: Id, data: Partial<Article>, params?: ServiceParams): Promise<Article> {
    const article = await this.articles.updateById(id, data);
    await this.logActivity(article.id, "updated", params);
    await this.reembed(article);
    return article;
  }

  async patch(id: Id, data: Partial<Article>, params?: ServiceParams): Promise<Article> {
    const article = await this.articles.patchById(id, data);
    await this.logActivity(article.id, "updated", params);
    await this.reembed(article);
    return article;
  }

  async remove(id: Id, params?: ServiceParams): Promise<Article> {
    const article = await this.articles.deleteById(id);
    await this.logActivity(article.id, "removed", params);
    return article;
  }

  private async logActivity(articleId: Id, action: string, params?: ServiceParams): Promise<void> {
    const actorId = (params?.user as { id?: number } | undefined)?.id ?? null;
    await this.activity.save({ entityType: "article", entityId: articleId, action, actorId });
  }

  private async reembed(article: Article): Promise<void> {
    const vector = await this.embedder.embed(`${article.title}\n${article.body}`);
    await this.vectors.upsertVector(article.id, vector, {});
  }
}
