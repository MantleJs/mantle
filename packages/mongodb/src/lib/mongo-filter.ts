import { ObjectId } from "mongodb";
import { assertOperators } from "@mantlejs/mantle";

/**
 * Exactly the `$`-operators `toMongoFilter` accepts. Everything else — including the
 * PostgreSQL-only `$like`/`$ilike`/`$notlike` family — is rejected with `BadRequest`
 * via `assertOperators`; use the raw `collection` escape hatch with `$regex` for
 * pattern matching instead.
 */
export const MONGO_OPERATORS = [
  "$lt",
  "$lte",
  "$gt",
  "$gte",
  "$ne",
  "$in",
  "$nin",
  "$or",
  "$and",
  "$contains",
] as const;

const SUPPORTED = new Set<string>(MONGO_OPERATORS);

export type WhereClause = Record<string, unknown>;

/**
 * Translate a Mantle `QueryParams.where` clause into a MongoDB filter document.
 *
 * Most operators (`$lt`/`$lte`/`$gt`/`$gte`/`$ne`/`$in`/`$nin`/`$or`/`$and`) are native
 * MongoDB syntax and pass through unchanged; dot-path keys (`"metadata.owner.name"`)
 * are native too. The two Mantle-specific translations:
 *
 * - `id` keys become `_id`, with 24-hex string values converted to `ObjectId` — the
 *   repository boundary only ever deals in string ids.
 * - `$contains` (jsonb `@>` semantics) becomes: scalar operand → field equality (MongoDB
 *   equality matches array elements natively), array operand → `$all`, object operand →
 *   recursively expanded dot-path conditions.
 */
export function toMongoFilter(where: WhereClause): Record<string, unknown> {
  assertOperators(where, SUPPORTED, "@mantlejs/mongodb");

  const filter: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(where)) {
    if (key === "$or" || key === "$and") {
      filter[key] = (value as WhereClause[]).map((clause) => toMongoFilter(clause));
    } else if (isOperatorObject(value)) {
      for (const [field, condition] of translateField(mapIdKey(key), value as Record<string, unknown>)) {
        mergeCondition(filter, field, key === "id" ? mapIdOperands(condition) : condition);
      }
    } else {
      mergeCondition(filter, mapIdKey(key), key === "id" ? toMongoIdValue(value) : value);
    }
  }

  return filter;
}

/** True when the value is a plain object carrying at least one `$`-operator key. */
function isOperatorObject(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value as Record<string, unknown>).some((k) => k.startsWith("$"))
  );
}

/**
 * Translate one field's operator object into `[field, condition]` pairs. Comparison
 * operators stay grouped under the field; `$contains` expands into its own pairs.
 */
function translateField(field: string, ops: Record<string, unknown>): Array<[string, unknown]> {
  const passthrough: Record<string, unknown> = {};
  const pairs: Array<[string, unknown]> = [];

  for (const [op, operand] of Object.entries(ops)) {
    if (op === "$contains") {
      expandContains(field, operand, (path, condition) => pairs.push([path, condition]));
    } else {
      passthrough[op] = operand;
    }
  }

  if (Object.keys(passthrough).length > 0) pairs.unshift([field, passthrough]);
  return pairs;
}

/**
 * Expand a `$contains` operand into MongoDB conditions with jsonb `@>` semantics:
 * arrays require every element (`$all`), objects recurse into dot-paths, scalars
 * rely on MongoDB's native "equality matches array elements" behaviour.
 */
function expandContains(path: string, operand: unknown, emit: (path: string, condition: unknown) => void): void {
  if (Array.isArray(operand)) {
    emit(path, { $all: operand });
  } else if (operand !== null && typeof operand === "object") {
    for (const [key, value] of Object.entries(operand as Record<string, unknown>)) {
      expandContains(`${path}.${key}`, value, emit);
    }
  } else {
    emit(path, operand);
  }
}

/** Add a condition to the filter; colliding keys are conjoined via `$and` instead of overwritten. */
function mergeCondition(filter: Record<string, unknown>, field: string, condition: unknown): void {
  if (!(field in filter)) {
    filter[field] = condition;
    return;
  }
  const and = (filter["$and"] as unknown[] | undefined) ?? [];
  and.push({ [field]: condition });
  filter["$and"] = and;
}

function mapIdKey(key: string): string {
  return key === "id" ? "_id" : key;
}

/** Convert operands of an `id` operator object (`$ne`, `$in`, `$nin`, comparisons) to `ObjectId`. */
function mapIdOperands(condition: unknown): unknown {
  if (condition === null || typeof condition !== "object" || Array.isArray(condition)) {
    return toMongoIdValue(condition);
  }
  return Object.fromEntries(
    Object.entries(condition as Record<string, unknown>).map(([op, operand]) => [
      op,
      Array.isArray(operand) ? operand.map(toMongoIdValue) : toMongoIdValue(operand),
    ]),
  );
}

function toMongoIdValue(value: unknown): unknown {
  return typeof value === "string" && ObjectId.isValid(value) ? new ObjectId(value) : value;
}

/** Translate a Mantle `QueryParams.sort` map to a MongoDB sort document (`id` → `_id`). */
export function toMongoSort(sort: Record<string, "asc" | "desc">): Record<string, 1 | -1> {
  return Object.fromEntries(Object.entries(sort).map(([field, dir]) => [mapIdKey(field), dir === "asc" ? 1 : -1]));
}

/** Translate a Mantle `QueryParams.select` list to a MongoDB projection (`_id` is always included). */
export function toMongoProjection(select: string[]): Record<string, 1> {
  return Object.fromEntries(select.filter((field) => field !== "id").map((field) => [field, 1 as const]));
}
