import { BadRequest } from "@mantlejs/mantle";

type Primitive = string | number | boolean | null;
type WhereValue = Primitive | Primitive[] | Record<string, unknown>;
export type WhereClause = Record<string, WhereValue>;

const VALID_FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Field identifiers are interpolated into Cypher unparameterized (Neo4j does not
 * support parameterized property names), so every identifier that can originate
 * from `params.query` must be whitelisted before it reaches `session.run`.
 */
export function assertValidFieldName(name: string): void {
  if (!VALID_FIELD_NAME.test(name)) {
    throw new BadRequest(`Invalid field name: ${name}`);
  }
}

export interface WhereResult {
  cypher: string;
  params: Record<string, unknown>;
}

/**
 * Convert a Mantle `QueryParams.where` clause to a Cypher WHERE expression and parameter map.
 *
 * The alias `n` is used for the node variable. All parameter keys are prefixed with `_w_`
 * plus a counter to avoid collisions.
 *
 * Mapping rules:
 *   { field: value }          → n.field = $p
 *   { field: null }           → n.field IS NULL
 *   { field: [a, b] }         → n.field IN $p
 *   { field: { $lt } }        → n.field < $p
 *   { field: { $lte } }       → n.field <= $p
 *   { field: { $gt } }        → n.field > $p
 *   { field: { $gte } }       → n.field >= $p
 *   { field: { $ne: v } }     → n.field <> $p
 *   { field: { $ne: null } }  → n.field IS NOT NULL
 *   { field: { $in: [...] } } → n.field IN $p
 *   { field: { $nin: [...] } }→ NOT n.field IN $p
 *   { field: { $like: 'x%' } }→ n.field STARTS WITH / ENDS WITH / CONTAINS $p  (heuristic)
 *   { field: { $ilike } }     → toLower(n.field) CONTAINS toLower($p)
 *   { field: { $notlike } }   → NOT (n.field CONTAINS $p)
 *   { $or: [...] }            → (a OR b OR ...)
 *   { $and: [...] }           → (a AND b AND ...)
 */
export function toNeo4jWhere(where: WhereClause, alias = "n"): WhereResult {
  const params: Record<string, unknown> = {};
  let counter = 0;

  function nextKey(): string {
    return `_w_${counter++}`;
  }

  function buildExpr(clause: WhereClause): string {
    const parts: string[] = [];

    for (const [key, value] of Object.entries(clause)) {
      if (key === "$or") {
        const subExprs = (value as unknown as WhereClause[]).map((c) => `(${buildExpr(c)})`);
        parts.push(`(${subExprs.join(" OR ")})`);
      } else if (key === "$and") {
        const subExprs = (value as unknown as WhereClause[]).map((c) => `(${buildExpr(c)})`);
        parts.push(`(${subExprs.join(" AND ")})`);
      } else if (value === null) {
        assertValidFieldName(key);
        parts.push(`${alias}.${key} IS NULL`);
      } else if (Array.isArray(value)) {
        assertValidFieldName(key);
        const pk = nextKey();
        params[pk] = value;
        parts.push(`${alias}.${key} IN $${pk}`);
      } else if (typeof value === "object") {
        assertValidFieldName(key);
        const ops = value as Record<string, unknown>;
        buildOpExpr(key, ops, parts);
      } else {
        assertValidFieldName(key);
        const pk = nextKey();
        params[pk] = value;
        parts.push(`${alias}.${key} = $${pk}`);
      }
    }

    return parts.join(" AND ") || "true";
  }

  function buildOpExpr(field: string, ops: Record<string, unknown>, parts: string[]): void {
    if ("$lt" in ops) {
      const pk = nextKey();
      params[pk] = ops["$lt"];
      parts.push(`${alias}.${field} < $${pk}`);
    }
    if ("$lte" in ops) {
      const pk = nextKey();
      params[pk] = ops["$lte"];
      parts.push(`${alias}.${field} <= $${pk}`);
    }
    if ("$gt" in ops) {
      const pk = nextKey();
      params[pk] = ops["$gt"];
      parts.push(`${alias}.${field} > $${pk}`);
    }
    if ("$gte" in ops) {
      const pk = nextKey();
      params[pk] = ops["$gte"];
      parts.push(`${alias}.${field} >= $${pk}`);
    }
    if ("$ne" in ops) {
      const v = ops["$ne"];
      if (v === null) {
        parts.push(`${alias}.${field} IS NOT NULL`);
      } else {
        const pk = nextKey();
        params[pk] = v;
        parts.push(`${alias}.${field} <> $${pk}`);
      }
    }
    if ("$in" in ops) {
      const pk = nextKey();
      params[pk] = ops["$in"];
      parts.push(`${alias}.${field} IN $${pk}`);
    }
    if ("$nin" in ops) {
      const pk = nextKey();
      params[pk] = ops["$nin"];
      parts.push(`NOT ${alias}.${field} IN $${pk}`);
    }
    if ("$like" in ops) {
      const pattern = ops["$like"] as string;
      const pk = nextKey();
      if (pattern.startsWith("%") && pattern.endsWith("%")) {
        params[pk] = pattern.slice(1, -1);
        parts.push(`${alias}.${field} CONTAINS $${pk}`);
      } else if (pattern.startsWith("%")) {
        params[pk] = pattern.slice(1);
        parts.push(`${alias}.${field} ENDS WITH $${pk}`);
      } else if (pattern.endsWith("%")) {
        params[pk] = pattern.slice(0, -1);
        parts.push(`${alias}.${field} STARTS WITH $${pk}`);
      } else {
        params[pk] = pattern;
        parts.push(`${alias}.${field} CONTAINS $${pk}`);
      }
    }
    if ("$ilike" in ops) {
      const pattern = (ops["$ilike"] as string).replace(/%/g, "").toLowerCase();
      const pk = nextKey();
      params[pk] = pattern;
      parts.push(`toLower(${alias}.${field}) CONTAINS $${pk}`);
    }
    if ("$notlike" in ops) {
      const pattern = (ops["$notlike"] as string).replace(/%/g, "");
      const pk = nextKey();
      params[pk] = pattern;
      parts.push(`NOT (${alias}.${field} CONTAINS $${pk})`);
    }
  }

  const cypher = buildExpr(where);
  return { cypher, params };
}
