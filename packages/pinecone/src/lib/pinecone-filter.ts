import { assertOperators, BadRequest } from "@mantlejs/mantle";

type Primitive = string | number | boolean | null;
type WhereValue = Primitive | Primitive[] | Record<string, unknown> | WhereClause[];
export type WhereClause = Record<string, WhereValue>;

const PASSTHROUGH_OPS = new Set(["$eq", "$lt", "$lte", "$gt", "$gte", "$ne", "$in", "$nin"]);

/** All query operators supported by the Pinecone adapter. */
export const PINECONE_OPERATORS: ReadonlySet<string> = new Set([...PASSTHROUGH_OPS, "$or", "$and"]);

/**
 * Convert a Mantle `QueryParams.where` clause to a Pinecone metadata filter object.
 *
 * Mapping rules:
 *   { field: value }              → { field: { $eq: value } }
 *   { field: null }               → { field: { $eq: null } }
 *   { field: [a, b] }             → { field: { $in: [a, b] } }
 *   { field: { $eq/$gt/$lt/… } } → passed through unchanged
 *   { field: { $ne/$in/$nin } }  → passed through unchanged
 *   { $or: [...] }               → { $or: [mapped…] }
 *   { $and: [...] }              → { $and: [mapped…] }
 *
 * Unsupported operators ($like and friends) throw `BadRequest` — Pinecone metadata
 * filters have no pattern matching.
 */
export function toPineconeFilter(where: WhereClause): Record<string, unknown> {
  assertOperators(where, PINECONE_OPERATORS, "@mantlejs/pinecone");
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
        if (!PASSTHROUGH_OPS.has(op)) {
          throw new BadRequest(
            `Operator ${op} is not supported by @mantlejs/pinecone. Supported: ${[...PINECONE_OPERATORS].join(", ")}`,
          );
        }
        ops[op] = operand;
      }
      filter[key] = ops;
    } else {
      filter[key] = { $eq: value };
    }
  }

  return filter;
}
