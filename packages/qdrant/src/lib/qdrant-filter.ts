import { assertOperators } from "@mantlejs/mantle";

type Primitive = string | number | boolean | null;
type WhereValue = Primitive | Primitive[] | Record<string, unknown> | WhereClause[];
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
  "$contains",
  "$or",
  "$and",
]);

/**
 * Flatten a `$contains` operand into one or more `must` conditions, mirroring the recursive
 * "field is a superset of this value" semantics the D-7 conformance fixture defines:
 *   - scalar operand   → a single match condition (Qdrant already matches "any element equals
 *                         this value" when the payload field is an array, so this is identical
 *                         in shape to a plain equality condition)
 *   - array operand    → one ANDed match condition per element (every element required, not
 *                         "any of" — `match.any` would be the wrong, OR, semantics here)
 *   - object operand   → recurse into each key as a nested dot-path (Qdrant addresses nested
 *                         payload fields natively via dot-path keys), flattening to leaf
 *                         conditions the same way for arrays/scalars found at each leaf
 */
function flattenContains(
  fieldPrefix: string,
  value: unknown,
  toField: (field: string) => string,
): Condition[] {
  if (Array.isArray(value)) {
    return value.map((item) => ({
      key: toField(fieldPrefix),
      match: { value: item as string | number | boolean },
    }));
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, nested]) =>
      flattenContains(`${fieldPrefix}.${key}`, nested, toField),
    );
  }
  return [{ key: toField(fieldPrefix), match: { value: value as string | number | boolean } }];
}

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
 *   { field: { $contains: v } }   → must: [flattened match conditions — see flattenContains]
 *   { $or: [...] }                → should: [mapped...]
 *   { $and: [...] }                → must: [mapped...]
 *
 * Nested fields (`"metadata.owner.name"`) are addressed natively — Qdrant's payload filter
 * `key` accepts dot-path strings directly, no translation needed.
 *
 * Unsupported operators (including $like/$ilike/$notlike) throw `BadRequest`.
 */
export function toQdrantFilter(
  where: WhereClause,
  toField: (field: string) => string = (field) => field,
): Record<string, unknown> {
  assertOperators(where, QDRANT_OPERATORS, "@mantlejs/qdrant");
  const must: Condition[] = [];
  const must_not: Condition[] = [];
  const should: Condition[] = [];

  for (const [rawKey, value] of Object.entries(where)) {
    if (rawKey === "$or") {
      for (const clause of value as unknown as WhereClause[]) {
        should.push(toQdrantFilter(clause, toField));
      }
      continue;
    }
    if (rawKey === "$and") {
      for (const clause of value as unknown as WhereClause[]) {
        must.push(toQdrantFilter(clause, toField));
      }
      continue;
    }

    const key = toField(rawKey);
    if (value === null) {
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

      if ("$contains" in ops) {
        must.push(...flattenContains(rawKey, ops["$contains"], toField));
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
