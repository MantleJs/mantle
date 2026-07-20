import type { Knex } from "knex";
import { assertOperators, BadRequest } from "@mantlejs/mantle";

type Primitive = string | number | boolean | null;
type WhereValue = Primitive | Primitive[] | Record<string, unknown> | WhereClause[];
export type WhereClause = Record<string, WhereValue>;

const COMPARISON_OPS: Record<string, string> = {
  $lt: "<",
  $lte: "<=",
  $gt: ">",
  $gte: ">=",
};

/** All query operators supported by the Knex adapter. */
export const KNEX_OPERATORS: ReadonlySet<string> = new Set([
  "$lt",
  "$lte",
  "$gt",
  "$gte",
  "$ne",
  "$in",
  "$nin",
  "$like",
  "$notlike",
  "$ilike",
  "$contains",
  "$or",
  "$and",
]);

/**
 * Translates a structured where clause (with query operators) into Knex query builder calls.
 *
 * Supported operators:
 *   Comparison : $lt, $lte, $gt, $gte
 *   Equality   : $ne, $in, $nin
 *   Logical    : $or, $and
 *   Pattern    : $like, $notlike, $ilike (PostgreSQL only)
 *   Containment: $contains — jsonb `@>` via whereJsonSupersetOf (PostgreSQL only)
 *   Null       : field: null  →  IS NULL
 *                field: { $ne: null }  →  IS NOT NULL
 */
export function knexify(builder: Knex.QueryBuilder, where: WhereClause): Knex.QueryBuilder {
  assertOperators(where, KNEX_OPERATORS, "@mantlejs/knex");
  for (const [key, value] of Object.entries(where)) {
    if (key === "$or") {
      builder = applyOr(builder, value as unknown as WhereClause[]);
    } else if (key === "$and") {
      builder = applyAnd(builder, value as unknown as WhereClause[]);
    } else if (value === null) {
      builder = builder.whereNull(key);
    } else if (Array.isArray(value)) {
      builder = builder.whereIn(key, value as Primitive[]);
    } else if (typeof value === "object") {
      builder = applyOperators(builder, key, value as Record<string, unknown>);
    } else {
      builder = builder.where(key, "=", value);
    }
  }
  return builder;
}

function applyOr(builder: Knex.QueryBuilder, conditions: WhereClause[]): Knex.QueryBuilder {
  return builder.where(function (this: Knex.QueryBuilder) {
    for (const condition of conditions) {
      this.orWhere(function (this: Knex.QueryBuilder) {
        knexify(this, condition);
      });
    }
  });
}

function applyAnd(builder: Knex.QueryBuilder, conditions: WhereClause[]): Knex.QueryBuilder {
  return builder.where(function (this: Knex.QueryBuilder) {
    for (const condition of conditions) {
      this.andWhere(function (this: Knex.QueryBuilder) {
        knexify(this, condition);
      });
    }
  });
}

function applyOperators(builder: Knex.QueryBuilder, col: string, ops: Record<string, unknown>): Knex.QueryBuilder {
  for (const [op, operand] of Object.entries(ops)) {
    if (op in COMPARISON_OPS) {
      builder = builder.where(col, COMPARISON_OPS[op], operand as Primitive);
    } else {
      builder = applySpecialOp(builder, col, op, operand);
    }
  }
  return builder;
}

function applySpecialOp(builder: Knex.QueryBuilder, col: string, op: string, value: unknown): Knex.QueryBuilder {
  switch (op) {
    case "$ne":
      return value === null ? builder.whereNotNull(col) : builder.whereNot(col, value as Primitive);
    case "$in":
      return builder.whereIn(col, value as Primitive[]);
    case "$nin":
      return builder.whereNotIn(col, value as Primitive[]);
    case "$like":
      return builder.whereLike(col, value as string);
    case "$notlike":
      return builder.whereRaw("?? NOT LIKE ?", [col, value as string]);
    case "$ilike":
      return builder.whereILike(col, value as string);
    case "$contains": {
      const client = (builder as unknown as { client?: { config?: { client?: string } } }).client?.config?.client ?? "";
      if (!client.startsWith("pg") && !client.startsWith("postgres")) {
        throw new BadRequest(
          `Operator $contains is only supported by @mantlejs/knex on PostgreSQL (current client: ${client || "unknown"}).`,
          undefined,
          undefined,
          "Use a PostgreSQL connection for jsonb containment queries, or filter in application code after fetching.",
        );
      }
      // Scalar operands are wrapped so "field contains element" matches the
      // memory reference (and avoids knex treating a string as raw JSON).
      const operand = typeof value === "object" && value !== null ? value : [value];
      return builder.whereJsonSupersetOf(col, operand as Record<string, unknown>);
    }
    default:
      throw new BadRequest(
        `Operator ${op} is not supported by @mantlejs/knex. Supported: ${[...KNEX_OPERATORS].join(", ")}`,
      );
  }
}
