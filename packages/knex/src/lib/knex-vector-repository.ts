import type { Id, QueryParams, VectorRepository } from "@mantlejs/mantle";
import { GeneralError } from "@mantlejs/mantle";
import { KnexRepository } from "./knex-repository.js";
import { knexify, mapWhereFields } from "./knexify.js";
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
      const vectorColumn = this.toColumn(this.vectorColumn);
      let query = this.qb(this.tableName);
      if (params?.where) {
        query = knexify(
          query,
          mapWhereFields(params.where as WhereClause, (field) => this.toColumn(field)),
        );
      }
      if (params?.skip != null) {
        query = query.offset(params.skip);
      }
      query = query.orderByRaw(`?? ${op} ?::vector`, [vectorColumn, vectorLiteral]).limit(topK);
      const rows = (await query.select(
        this.knex.raw(`*, ?? ${op} ?::vector AS _score`, [vectorColumn, vectorLiteral]),
      )) as Array<Record<string, unknown>>;
      return rows.map((row) => {
        const { _score, ...columns } = row;
        const entity = this.mapRowToEntity(columns) as T & { _score: number; _distance: number };
        entity._score = _score as number;
        /** @deprecated `_distance` mirrors `_score` for one release — read `_score` instead. */
        entity._distance = _score as number;
        return entity;
      });
    } catch (err) {
      if (err instanceof GeneralError) throw err;
      throw this.wrapError(err);
    }
  }

  /**
   * Upsert a record with its embedding vector: updates the vector and data columns on an
   * existing row (but not createdAt), or inserts a new one.
   *
   * Deliberately an UPDATE followed by a conditional INSERT rather than a single
   * `INSERT ... ON CONFLICT DO UPDATE` — Postgres validates NOT NULL constraints on the full
   * candidate insert tuple before checking for a conflict, so a single-statement upsert that
   * only lists the id/vector/timestamp columns fails on any other NOT NULL column (e.g. a
   * required `title`) even when the conflicting row already has one. Not atomic: a concurrent
   * upsertVector on the same id between the UPDATE and the INSERT could race to insert twice.
   */
  async upsertVector(id: Id, vector: number[], data: Partial<T>): Promise<T> {
    this.assertPostgres();
    try {
      const vectorLiteral = this.toVectorLiteral(vector);
      const vectorRaw = this.knex.raw("?::vector", [vectorLiteral]);
      const now = new Date();
      const idColumn = this.toColumn(this.idField);
      const vectorColumn = this.toColumn(this.vectorColumn);
      const mappedData = this.mapDataToColumns(data as Record<string, unknown>);

      const updatePayload: Record<string, unknown> = {
        ...mappedData,
        [vectorColumn]: vectorRaw,
        ...(this.timestamps ? { [this.toColumn(this.updatedAtField)]: now } : {}),
      };
      const [updated] = await this.qb(this.tableName).where(idColumn, id).update(updatePayload).returning("*");
      if (updated) {
        return this.mapRowToEntity(updated as Record<string, unknown>);
      }

      const insertPayload: Record<string, unknown> = {
        [idColumn]: id,
        ...mappedData,
        [vectorColumn]: vectorRaw,
        ...(this.timestamps
          ? { [this.toColumn(this.createdAtField)]: now, [this.toColumn(this.updatedAtField)]: now }
          : {}),
      };
      const [inserted] = await this.qb(this.tableName).insert(insertPayload).returning("*");
      return this.mapRowToEntity(inserted as Record<string, unknown>);
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
