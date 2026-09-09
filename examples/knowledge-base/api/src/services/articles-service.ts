import type { Id, QueryParams, Repository, Service, ServiceParams, VectorRepository } from "@mantlejs/mantle";
import { BadRequest, NotFound } from "@mantlejs/mantle";
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
    return this.articles.findAll(parseArticlesQuery(params?.query ?? {}));
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

/**
 * Splits the framework's reserved query keys (`$limit`/`$skip`/`$sort`/`$select` — see
 * `RepositoryService.parseQuery` in `@mantlejs/mantle`) out of an otherwise-`where` query
 * object. `ArticlesService` doesn't extend `RepositoryService` (it composes repositories
 * instead), so it doesn't get this translation for free — passing `params.query` straight
 * through as `where` would mistake e.g. `$sort` for a field-equality filter and reject it as
 * an unsupported operator.
 */
function parseArticlesQuery(query: Record<string, unknown>): QueryParams {
  const where: Record<string, unknown> = {};
  const parsed: QueryParams = { where };

  for (const [key, value] of Object.entries(query)) {
    if (key === "$limit") parsed.limit = toNonNegativeInt(key, value);
    else if (key === "$skip") parsed.skip = toNonNegativeInt(key, value);
    else if (key === "$sort") parsed.sort = toSort(value);
    else if (key === "$select") parsed.select = Array.isArray(value) ? (value as string[]) : [String(value)];
    else where[key] = value;
  }

  return parsed;
}

function toNonNegativeInt(key: string, value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n < 0) {
    throw new BadRequest(`${key} must be a non-negative integer, got '${String(value)}'`);
  }
  return n;
}

function toSort(value: unknown): Record<string, "asc" | "desc"> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequest("$sort must be an object of field: asc|desc pairs");
  }
  const sort: Record<string, "asc" | "desc"> = {};
  for (const [field, dir] of Object.entries(value as Record<string, unknown>)) {
    const d = String(dir);
    if (d === "asc" || d === "1") sort[field] = "asc";
    else if (d === "desc" || d === "-1") sort[field] = "desc";
    else throw new BadRequest(`$sort direction for '${field}' must be asc, desc, 1, or -1, got '${d}'`);
  }
  return sort;
}
