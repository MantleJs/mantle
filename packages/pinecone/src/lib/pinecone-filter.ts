type Primitive = string | number | boolean | null;
type WhereValue = Primitive | Primitive[] | Record<string, unknown>;
export type WhereClause = Record<string, WhereValue>;

const PASSTHROUGH_OPS = new Set(["$lt", "$lte", "$gt", "$gte", "$ne", "$in", "$nin"]);

/**
 * Convert a Mantle `QueryParams.where` clause to a Pinecone metadata filter object.
 *
 * Mapping rules:
 *   { field: value }              → { field: { $eq: value } }
 *   { field: null }               → { field: { $eq: null } }
 *   { field: [a, b] }             → { field: { $in: [a, b] } }
 *   { field: { $gt/$lt/… } }     → passed through unchanged
 *   { field: { $ne/$in/$nin } }  → passed through unchanged
 *   { $or: [...] }               → { $or: [mapped…] }
 *   { $and: [...] }              → { $and: [mapped…] }
 *   { field: { $like/… } }       → silently ignored (unsupported by Pinecone)
 */
export function toPineconeFilter(where: WhereClause): Record<string, unknown> {
  const filter: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(where)) {
    if (key === "$or" || key === "$and") {
      filter[key] = (value as unknown as WhereClause[]).map(toPineconeFilter);
    } else if (value === null) {
      filter[key] = { $eq: null };
    } else if (Array.isArray(value)) {
      filter[key] = { $in: value };
    } else if (typeof value === "object") {
      const ops: Record<string, unknown> = {};
      for (const [op, operand] of Object.entries(value as Record<string, unknown>)) {
        if (PASSTHROUGH_OPS.has(op)) {
          ops[op] = operand;
        }
      }
      filter[key] = ops;
    } else {
      filter[key] = { $eq: value };
    }
  }

  return filter;
}
