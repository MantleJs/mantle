import { assertOperators } from "@mantlejs/mantle";

type Primitive = string | number | boolean | null;
type WhereValue = Primitive | Primitive[] | Record<string, unknown>;
export type WhereClause = Record<string, WhereValue>;

type Condition = Record<string, unknown>;

/**
 * All query operators supported by the Qdrant adapter.
 * `$like`/`$ilike`/`$notlike` are deliberately absent: remapping them to Qdrant
 * full-text match would silently change their semantics.
 */
export const QDRANT_OPERATORS: ReadonlySet<string> = new Set([
  "$lt",
  "$lte",
  "$gt",
  "$gte",
  "$ne",
  "$in",
  "$nin",
  "$or",
  "$and",
]);

/**
 * Convert a Mantle `QueryParams.where` clause to a Qdrant payload filter object.
 *
 * Mapping rules:
 *   { field: value }              → must: [{ key: "field", match: { value } }]
 *   { field: null }               → must: [{ is_null: { key: "field" } }]
 *   { field: [a, b] }             → must: [{ key: "field", match: { any: [a, b] } }]
 *   { field: { $lt/$lte/$gt/$gte } } → must: [{ key: "field", range: { ... } }]
 *   { field: { $ne: value } }     → must_not: [{ key: "field", match: { value } }]
 *   { field: { $ne: null } }      → must_not: [{ is_null: { key: "field" } }]
 *   { field: { $in: [...] } }     → must: [{ key: "field", match: { any: [...] } }]
 *   { field: { $nin: [...] } }    → must_not: [{ key: "field", match: { any: [...] } }]
 *   { $or: [...] }                → should: [mapped...]
 *   { $and: [...] }               → must: [mapped...]
 *
 * Unsupported operators (including $like/$ilike/$notlike) throw `BadRequest`.
 */
export function toQdrantFilter(where: WhereClause): Record<string, unknown> {
  assertOperators(where, QDRANT_OPERATORS, "@mantlejs/qdrant");
  const must: Condition[] = [];
  const must_not: Condition[] = [];
  const should: Condition[] = [];

  for (const [key, value] of Object.entries(where)) {
    if (key === "$or") {
      for (const clause of value as unknown as WhereClause[]) {
        should.push(toQdrantFilter(clause));
      }
    } else if (key === "$and") {
      for (const clause of value as unknown as WhereClause[]) {
        must.push(toQdrantFilter(clause));
      }
    } else if (value === null) {
      must.push({ is_null: { key } });
    } else if (Array.isArray(value)) {
      must.push({ key, match: { any: value } });
    } else if (typeof value === "object") {
      const ops = value as Record<string, unknown>;

      const range: Record<string, number> = {};
      if ("$lt" in ops) range["lt"] = ops["$lt"] as number;
      if ("$lte" in ops) range["lte"] = ops["$lte"] as number;
      if ("$gt" in ops) range["gt"] = ops["$gt"] as number;
      if ("$gte" in ops) range["gte"] = ops["$gte"] as number;
      if (Object.keys(range).length > 0) {
        must.push({ key, range });
      }

      if ("$ne" in ops) {
        const v = ops["$ne"];
        if (v === null) {
          must_not.push({ is_null: { key } });
        } else {
          must_not.push({ key, match: { value: v as string | number | boolean } });
        }
      }

      if ("$in" in ops) {
        must.push({ key, match: { any: ops["$in"] as (string | number)[] } });
      }

      if ("$nin" in ops) {
        must_not.push({ key, match: { any: ops["$nin"] as (string | number)[] } });
      }
    } else {
      must.push({ key, match: { value: value as string | number | boolean } });
    }
  }

  const filter: Record<string, unknown> = {};
  if (must.length > 0) filter["must"] = must;
  if (must_not.length > 0) filter["must_not"] = must_not;
  if (should.length > 0) filter["should"] = should;
  return filter;
}
