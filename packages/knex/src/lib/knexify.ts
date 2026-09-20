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

/**
 * All query operators the Knex adapter's translator understands. This is a superset across every
 * supported client — the connected client decides which of these actually execute; `$contains`
 * and dot-path field names throw a clear, client-naming `BadRequest` when the connected client
 * doesn't support them, rather than silently producing wrong or broken SQL. See
 * `clientCapabilities()` for the per-client breakdown this adapter's `describe()` reports.
 */
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

type ClientFamily = "pg" | "mysql" | "sqlite" | "mssql" | "unknown";

function clientOf(builder: Knex.QueryBuilder): string {
  return (builder as unknown as { client?: { config?: { client?: string } } }).client?.config?.client ?? "";
}

function familyOf(client: string): ClientFamily {
  if (client.startsWith("pg") || client.startsWith("postgres")) return "pg";
  if (client.startsWith("mysql")) return "mysql";
  if (client.startsWith("sqlite") || client.startsWith("better-sqlite")) return "sqlite";
  if (client.startsWith("mssql")) return "mssql";
  return "unknown";
}

/** Clients with a native JSON-superset function: pg's jsonb `@>`, MySQL's `JSON_CONTAINS`.
 * SQLite and MSSQL have no equivalent (confirmed against knex's own dialect compilers, which
 * throw "Json superset where clause not actually supported" for both). */
const CONTAINS_FAMILIES: ReadonlySet<ClientFamily> = new Set(["pg", "mysql"]);

/** Clients whose dot-path (nested JSON field) querying is implemented, via Knex's own
 * cross-dialect `whereJsonPath` — pg's `jsonb_path_query_first`, MySQL/SQLite's `json_extract`,
 * MSSQL's `JSON_VALUE`. All four verified against real database containers before shipping. */
const JSON_PATH_FAMILIES: ReadonlySet<ClientFamily> = new Set(["pg", "mysql", "sqlite", "mssql"]);

/**
 * The per-client capability breakdown this adapter's `describe()` reports — computed from the
 * actual connected client string rather than a single static constant, so `describe()` can't
 * drift from what the translator actually does (the bug this refactor fixes: `describe()` used
 * to advertise `$contains` unconditionally even though only PostgreSQL could execute it). Takes
 * a plain client string (not a `Knex.QueryBuilder`) so callers can feed it either the raw `Knex`
 * instance's `client.config.client` (what `KnexRepository.describe()` does, matching the same
 * client-detection convention its `supportsReturning` getter already uses) or a query builder's.
 */
export function capabilitiesForClient(client: string): { operators: string[]; nestedPaths: boolean } {
  const family = familyOf(client);
  const operators = [...KNEX_OPERATORS].filter((op) => op !== "$contains" || CONTAINS_FAMILIES.has(family));
  return { operators, nestedPaths: JSON_PATH_FAMILIES.has(family) };
}

/**
 * Translates a structured where clause (with query operators) into Knex query builder calls.
 *
 * Supported operators:
 *   Comparison : $lt, $lte, $gt, $gte
 *   Equality   : $ne, $in, $nin
 *   Logical    : $or, $and
 *   Pattern    : $like, $notlike, $ilike (all clients — Knex compiles LIKE/ILIKE per dialect)
 *   Containment: $contains — jsonb `@>` (PostgreSQL) or `JSON_CONTAINS` (MySQL) only
 *   Null       : field: null  →  IS NULL
 *                field: { $ne: null }  →  IS NOT NULL
 *
 * Dot-path field names (`"metadata.owner.name"`) address nested JSON fields on PostgreSQL,
 * MySQL, SQLite, and MSSQL, for equality, $lt/$lte/$gt/$gte/$ne/$like/$notlike (`$ilike` on
 * PostgreSQL only — it isn't standard SQL, unlike the others). `$in`/`$nin`/null-checks on a
 * dot-path field, and `$contains` combined with a dot-path field on a client outside
 * `CONTAINS_FAMILIES`, throw a clear `BadRequest` rather than emitting wrong or broken SQL.
 */
export function knexify(builder: Knex.QueryBuilder, where: WhereClause): Knex.QueryBuilder {
  assertOperators(where, KNEX_OPERATORS, "@mantlejs/knex");
  for (const [key, value] of Object.entries(where)) {
    if (key === "$or") {
      builder = applyOr(builder, value as unknown as WhereClause[]);
    } else if (key === "$and") {
      builder = applyAnd(builder, value as unknown as WhereClause[]);
    } else if (key.includes(".")) {
      builder = applyDotPath(builder, key, value);
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

/**
 * Renames the field keys of a where clause via `toColumn`, recursing into `$or`/`$and`
 * branches and leaving operator keys ($lt, $ne, …) and values untouched.
 *
 * For a dot-path field (`"metadata.ownerName"`), only the *root* segment — the actual SQL
 * column — goes through `toColumn`. The remaining segments are JSON key names inside the
 * stored document, not SQL identifiers, so `fieldMap`/`columnCase` (e.g. `snake_case`) must
 * never touch them: they describe the table's column-naming convention, not the shape of
 * whatever JSON happens to be stored in one jsonb/JSON column.
 */
export function mapWhereFields(where: WhereClause, toColumn: (field: string) => string): WhereClause {
  const mapped: WhereClause = {};
  for (const [key, value] of Object.entries(where)) {
    if (key === "$or" || key === "$and") {
      mapped[key] = (value as WhereClause[]).map((condition) => mapWhereFields(condition, toColumn));
    } else if (key.includes(".")) {
      const [root, ...rest] = key.split(".");
      mapped[[toColumn(root), ...rest].join(".")] = value as WhereValue;
    } else {
      mapped[toColumn(key)] = value as WhereValue;
    }
  }
  return mapped;
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
    case "$contains":
      return applyContains(builder, col, value);
    default:
      throw new BadRequest(
        `Operator ${op} is not supported by @mantlejs/knex. Supported: ${[...KNEX_OPERATORS].join(", ")}`,
      );
  }
}

function applyContains(builder: Knex.QueryBuilder, col: string, value: unknown): Knex.QueryBuilder {
  const family = familyOf(clientOf(builder));
  if (!CONTAINS_FAMILIES.has(family)) {
    throw new BadRequest(
      `Operator $contains is only supported by @mantlejs/knex on PostgreSQL and MySQL (current client: ${clientOf(builder) || "unknown"}).`,
      undefined,
      undefined,
      "Use a PostgreSQL or MySQL connection for JSON containment queries, or filter in application code after fetching.",
    );
  }
  // Scalar operands are wrapped so "field contains element" matches the
  // memory reference (and avoids knex treating a string as raw JSON).
  const operand = typeof value === "object" && value !== null ? value : [value];
  return builder.whereJsonSupersetOf(col, operand as Record<string, unknown>);
}

// ─── Dot-path (nested JSON field) support ────────────────────────────────────

/** Operators `whereJsonPath` can express directly — its `operator` argument only accepts a
 * fixed SQL-comparison vocabulary (no `IN`, no null checks). `$ilike` is pg-only: "ilike" isn't
 * standard SQL, unlike "like"/"not like"/"!=", which are valid raw syntax on all four dialects. */
const JSON_PATH_OPERATORS: Record<string, string> = {
  $lt: "<",
  $lte: "<=",
  $gt: ">",
  $gte: ">=",
  $ne: "!=",
  $like: "like",
  $notlike: "not like",
};

function splitDotPath(field: string): { root: string; jsonPath: string } {
  const segments = field.split(".");
  const root = segments.shift() as string;
  return { root, jsonPath: `$.${segments.join(".")}` };
}

function requireJsonPathSupport(builder: Knex.QueryBuilder, field: string): ClientFamily {
  const family = familyOf(clientOf(builder));
  if (!JSON_PATH_FAMILIES.has(family)) {
    throw new BadRequest(
      `Nested field "${field}" is not supported by @mantlejs/knex on this client (current client: ${clientOf(builder) || "unknown"}). Supported: PostgreSQL, MySQL, SQLite, MSSQL.`,
      undefined,
      undefined,
      "Use one of the supported clients for nested JSON field queries, or filter in application code after fetching.",
    );
  }
  return family;
}

function applyDotPathScalar(
  builder: Knex.QueryBuilder,
  field: string,
  operator: string,
  value: Primitive,
): Knex.QueryBuilder {
  requireJsonPathSupport(builder, field);
  const { root, jsonPath } = splitDotPath(field);
  return builder.whereJsonPath(root, jsonPath, operator, value);
}

function applyDotPathContains(builder: Knex.QueryBuilder, field: string, value: unknown): Knex.QueryBuilder {
  const family = familyOf(clientOf(builder));
  if (!CONTAINS_FAMILIES.has(family)) {
    throw new BadRequest(
      `Operator $contains on nested field "${field}" is only supported by @mantlejs/knex on PostgreSQL and MySQL (current client: ${clientOf(builder) || "unknown"}).`,
      undefined,
      undefined,
      "Use a PostgreSQL or MySQL connection for nested JSON containment queries, or filter in application code after fetching.",
    );
  }
  const { root, jsonPath } = splitDotPath(field);
  const operand = typeof value === "object" && value !== null ? value : [value];
  if (family === "pg") {
    // jsonb #> extracts the sub-document at the path (as a text[] path array); @> checks
    // containment against it — verified against a real Postgres container.
    const pathArray = jsonPath.slice(2).split("."); // "$.a.b" -> ["a", "b"]
    return builder.whereRaw("?? #> ? @> ?::jsonb", [root, `{${pathArray.join(",")}}`, JSON.stringify(operand)]);
  }
  // MySQL's JSON_CONTAINS(target, candidate, path) — verified against a real MySQL container.
  return builder.whereRaw("JSON_CONTAINS(??, ?, ?)", [root, JSON.stringify(operand), jsonPath]);
}

function applyDotPath(builder: Knex.QueryBuilder, field: string, value: WhereValue): Knex.QueryBuilder {
  if (value === null) {
    throw new BadRequest(
      `Null checks on nested field "${field}" are not supported by @mantlejs/knex.`,
      undefined,
      undefined,
      "Filter in application code after fetching, or restructure the schema so the null check applies to a top-level column.",
    );
  }
  if (Array.isArray(value)) {
    throw new BadRequest(
      `The array shorthand ($in) on nested field "${field}" is not supported by @mantlejs/knex.`,
      undefined,
      undefined,
      'Use an explicit $contains, or filter in application code after fetching. ("$in"/"$nin" on nested fields are unsupported for the same reason.)',
    );
  }
  if (typeof value === "object") {
    const ops = value as Record<string, unknown>;
    let result = builder;
    for (const [op, operand] of Object.entries(ops)) {
      if (op === "$contains") {
        result = applyDotPathContains(result, field, operand);
      } else if (op === "$in" || op === "$nin") {
        throw new BadRequest(
          `Operator ${op} on nested field "${field}" is not supported by @mantlejs/knex.`,
          undefined,
          undefined,
          "Filter in application code after fetching.",
        );
      } else if (op === "$ilike") {
        requireIlikeOnPg(result, field);
        const { root, jsonPath } = splitDotPath(field);
        result = result.whereJsonPath(root, jsonPath, "ilike", operand as Primitive);
      } else if (op in JSON_PATH_OPERATORS) {
        result = applyDotPathScalar(result, field, JSON_PATH_OPERATORS[op], operand as Primitive);
      } else {
        throw new BadRequest(
          `Operator ${op} is not supported by @mantlejs/knex. Supported: ${[...KNEX_OPERATORS].join(", ")}`,
        );
      }
    }
    return result;
  }
  return applyDotPathScalar(builder, field, "=", value);
}

function requireIlikeOnPg(builder: Knex.QueryBuilder, field: string): void {
  if (familyOf(clientOf(builder)) !== "pg") {
    throw new BadRequest(
      `Operator $ilike on nested field "${field}" is only supported by @mantlejs/knex on PostgreSQL (current client: ${clientOf(builder) || "unknown"}).`,
      undefined,
      undefined,
      "Use $like on this client (case-sensitivity may already match your column's collation), or filter in application code after fetching.",
    );
  }
}
