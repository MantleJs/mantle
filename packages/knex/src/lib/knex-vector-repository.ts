import type { Id, QueryParams, VectorRepository } from "@mantlejs/mantle";
import { GeneralError } from "@mantlejs/mantle";
import { KnexRepository } from "./knex-repository.js";
import { knexify } from "./knexify.js";
import type { WhereClause } from "./knexify.js";

export type DistanceOperator = "<=>" | "<#>" | "<->";

/**
 * Extends KnexRepository with pgvector support for PostgreSQL.
 * Subclasses must be connected to a `pg` client — vector methods throw GeneralError on other databases.
 */
export abstract class KnexVectorRepository<T extends Record<string, unknown>, D = Partial<T>>
  extends KnexRepository<T, D>
  implements VectorRepository<T, D>
{
  readonly vectorColumn: string = "embedding";
  readonly distanceOperator: DistanceOperator = "<=>";

  private assertPostgres(): void {
    const client = (this.knex.client as unknown as { config?: { client?: string } }).config?.client ?? "";
    if (!client.startsWith("pg")) {
      throw new GeneralError("pgvector operations require a PostgreSQL (pg) connection");
    }
  }

  private toVectorLiteral(vector: number[]): string {
    return `[${vector.join(",")}]`;
  }

  /**
   * Find the top-K records most similar to the given embedding vector.
   * Results include a synthetic `_score` column with the computed pgvector distance —
   * LOWER is more similar (it is a distance, not a similarity).
   * Generates: SELECT *, <col> <op> $1::vector AS _score FROM <table> ORDER BY <col> <op> $1::vector LIMIT $2
   */
  async findSimilar(vector: number[], topK: number, params?: QueryParams): Promise<Array<T & { _score: number }>> {
    this.assertPostgres();
    try {
      const vectorLiteral = this.toVectorLiteral(vector);
      const op = this.distanceOperator;
      let query = this.qb(this.tableName);
      if (params?.where) {
        query = knexify(query, params.where as WhereClause);
      }
      if (params?.skip != null) {
        query = query.offset(params.skip);
      }
      query = query.orderByRaw(`?? ${op} ?::vector`, [this.vectorColumn, vectorLiteral]).limit(topK);
      const rows = (await query.select(
        this.knex.raw(`*, ?? ${op} ?::vector AS _score`, [this.vectorColumn, vectorLiteral]),
      )) as Array<T & { _score: number }>;
      /** @deprecated `_distance` mirrors `_score` for one release — read `_score` instead. */
      return rows.map((row) => ({ ...row, _distance: row._score }));
    } catch (err) {
      if (err instanceof GeneralError) throw err;
      throw this.wrapError(err);
    }
  }

  /**
   * Upsert a record with its embedding vector.
   * On conflict with the idField, updates the vector and data columns (but not createdAt).
   */
  async upsertVector(id: Id, vector: number[], data: Partial<T>): Promise<T> {
    this.assertPostgres();
    try {
      const vectorLiteral = this.toVectorLiteral(vector);
      const vectorRaw = this.knex.raw("?::vector", [vectorLiteral]);
      const now = new Date();
      const insertPayload: Record<string, unknown> = {
        [this.idField]: id,
        ...data,
        [this.vectorColumn]: vectorRaw,
        ...(this.timestamps ? { createdAt: now, updatedAt: now } : {}),
      };
      const mergePayload: Record<string, unknown> = {
        ...data,
        [this.vectorColumn]: vectorRaw,
        ...(this.timestamps ? { updatedAt: now } : {}),
      };
      const [row] = await this.qb(this.tableName)
        .insert(insertPayload)
        .onConflict(this.idField)
        .merge(mergePayload)
        .returning("*");
      return row as T;
    } catch (err) {
      if (err instanceof GeneralError) throw err;
      throw this.wrapError(err);
    }
  }

  /** Delete a record and its associated vector by id. */
  async deleteVector(id: Id): Promise<T> {
    this.assertPostgres();
    return this.deleteById(id);
  }
}
