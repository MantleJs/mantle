import { KnexRepository, KnexVectorRepository } from "@mantlejs/knex";
import type { Article } from "../entities/article.js";

export class ArticleRepository extends KnexRepository<Article> {
  readonly tableName = "articles";
}

/** Same table as `ArticleRepository` — adds `findSimilar`/`upsertVector` over its `embedding` column. */
export class ArticleVectorRepository extends KnexVectorRepository<Article> {
  readonly tableName = "articles";
}
