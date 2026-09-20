import { type AttributeValue, type Condition } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
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
 * All query operators supported by the DynamoDB adapter.
 * `$like` is deliberately absent: DynamoDB has no wildcard matching, and remapping
 * it to `contains()` would silently change its semantics.
 */
export const DYNAMODB_OPERATORS: ReadonlySet<string> = new Set([
  "$lt",
  "$lte",
  "$gt",
  "$gte",
  "$ne",
  "$in",
  "$nin",
  "$begins",
  "$contains",
  "$or",
  "$and",
]);

export interface FilterExpression {
  /** The filter expression string, e.g. "#n0 = :v0 AND #n1 > :v1" */
  expression: string;
  /** ExpressionAttributeNames — aliases for reserved words / dots in field names */
  names: Record<string, string>;
  /** ExpressionAttributeValues — typed AttributeValue map */
  values: Record<string, AttributeValue>;
}

interface BuildContext {
  names: Record<string, string>;
  values: Record<string, AttributeValue>;
  nameIdx: number;
  valIdx: number;
}

/**
 * Translates a Mantle `QueryParams.where` clause into a DynamoDB FilterExpression
 * (suitable for Scan and Query operations).
 *
 * Supported operators:
 *   Comparison : $lt, $lte, $gt, $gte
 *   Equality   : field = value, $ne
 *   Null check : field: null  →  attribute_not_exists / null check
 *   Inclusion  : $in, $nin
 *   Logical    : $or, $and
 *   Pattern    : $begins (begins_with)
 *   Contains   : $contains
 *
 * Unsupported operators (including `$like`) throw `BadRequest`.
 */
export function dynamodbify(
  where: WhereClause,
  toField: (field: string) => string = (field) => field,
): FilterExpression {
  assertOperators(where, DYNAMODB_OPERATORS, "@mantlejs/dynamodb");
  const ctx: BuildContext = { names: {}, values: {}, nameIdx: 0, valIdx: 0 };
  const expression = buildExpression(where, ctx, toField);
  return { expression, names: ctx.names, values: ctx.values };
}

function buildExpression(where: WhereClause, ctx: BuildContext, toField: (field: string) => string): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(where)) {
    if (key === "$or") {
      parts.push(buildLogical(value as unknown as WhereClause[], "OR", ctx, toField));
    } else if (key === "$and") {
      parts.push(buildLogical(value as unknown as WhereClause[], "AND", ctx, toField));
    } else {
      const field = toField(key);
      parts.push(buildFieldCondition(field, value, ctx));
    }
  }
  return parts.join(" AND ");
}

function buildLogical(
  conditions: WhereClause[],
  op: "AND" | "OR",
  ctx: BuildContext,
  toField: (field: string) => string,
): string {
  const parts = conditions.map((c) => `(${buildExpression(c, ctx, toField)})`);
  return `(${parts.join(` ${op} `)})`;
}

/**
 * Build an ExpressionAttributeNames alias for a field, splitting dot-paths into one alias per
 * segment joined by "." (`#n0.#n1.#n2`) so DynamoDB treats it as nested-attribute traversal —
 * not a single literal attribute name that happens to contain dots.
 */
function nameAlias(field: string, ctx: BuildContext): string {
  if (!field.includes(".")) {
    const alias = `#n${ctx.nameIdx++}`;
    ctx.names[alias] = field;
    return alias;
  }
  return field
    .split(".")
    .map((segment) => {
      const alias = `#n${ctx.nameIdx++}`;
      ctx.names[alias] = segment;
      return alias;
    })
    .join(".");
}

function valueAlias(val: unknown, ctx: BuildContext): string {
  const alias = `:v${ctx.valIdx++}`;
  ctx.values[alias] = marshall({ v: val })["v"] as AttributeValue;
  return alias;
}

function buildFieldCondition(field: string, value: WhereValue, ctx: BuildContext): string {
  const n = nameAlias(field, ctx);

  if (value === null) {
    const v = valueAlias(null, ctx);
    return `(attribute_not_exists(${n}) OR ${n} = ${v})`;
  }

  if (Array.isArray(value)) {
    // $in shorthand: { field: [a, b, c] }
    return buildIn(n, value as Primitive[], ctx);
  }

  if (typeof value === "object") {
    return buildOperators(n, field, value as Record<string, unknown>, ctx);
  }

  const v = valueAlias(value, ctx);
  return `${n} = ${v}`;
}

function buildIn(nameAlias_: string, values: Primitive[], ctx: BuildContext): string {
  const aliases = values.map((v) => valueAlias(v, ctx));
  return `${nameAlias_} IN (${aliases.join(", ")})`;
}

function buildOperators(n: string, field: string, ops: Record<string, unknown>, ctx: BuildContext): string {
  const parts: string[] = [];
  for (const [op, operand] of Object.entries(ops)) {
    if (op in COMPARISON_OPS) {
      const v = valueAlias(operand, ctx);
      parts.push(`${n} ${COMPARISON_OPS[op]} ${v}`);
    } else {
      parts.push(buildSpecialOp(n, field, op, operand, ctx));
    }
  }
  return parts.join(" AND ");
}

/**
 * Flatten a `$contains` object operand into leaf conditions, one per nested dot-path — the same
 * "recursive superset" idea as jsonb `@>`, since DynamoDB has no native nested-object containment
 * function. A leaf array value still requires every element (ANDed `contains()` calls); a leaf
 * scalar requires exact equality.
 */
function flattenContainsConditions(fieldPrefix: string, value: unknown, ctx: BuildContext): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => `contains(${nameAlias(fieldPrefix, ctx)}, ${valueAlias(item, ctx)})`);
  }
  if (value !== null && typeof value === "object") {
    const conditions: string[] = [];
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      conditions.push(...flattenContainsConditions(`${fieldPrefix}.${key}`, nested, ctx));
    }
    return conditions;
  }
  return [`${nameAlias(fieldPrefix, ctx)} = ${valueAlias(value, ctx)}`];
}

function buildSpecialOp(n: string, field: string, op: string, value: unknown, ctx: BuildContext): string {
  switch (op) {
    case "$ne": {
      if (value === null) {
        return `attribute_exists(${n})`;
      }
      const v = valueAlias(value, ctx);
      return `${n} <> ${v}`;
    }
    case "$in": {
      return buildIn(n, value as Primitive[], ctx);
    }
    case "$nin": {
      const aliases = (value as Primitive[]).map((item) => valueAlias(item, ctx));
      return `NOT (${n} IN (${aliases.join(", ")}))`;
    }
    case "$begins": {
      const v = valueAlias(value, ctx);
      return `begins_with(${n}, ${v})`;
    }
    case "$contains": {
      // Array operand: "field contains every element" — DynamoDB's contains() only checks a
      // single scalar operand, so an array-required-elements check needs one ANDed call per
      // element (matches the memory/knex-pg reference semantics, not "contains this one list").
      if (Array.isArray(value)) {
        if (value.length === 0) return `attribute_exists(${n})`;
        const parts = value.map((item) => `contains(${n}, ${valueAlias(item, ctx)})`);
        return `(${parts.join(" AND ")})`;
      }
      // Object operand: no native nested-superset function — flatten into per-path leaf checks.
      if (value !== null && typeof value === "object") {
        const parts = flattenContainsConditions(field, value, ctx);
        return parts.length > 0 ? `(${parts.join(" AND ")})` : `attribute_exists(${n})`;
      }
      const v = valueAlias(value, ctx);
      return `contains(${n}, ${v})`;
    }
    default: {
      throw new BadRequest(
        `Operator ${op} is not supported by @mantlejs/dynamodb. Supported: ${[...DYNAMODB_OPERATORS].join(", ")}`,
      );
    }
  }
}

// ─── KeyConditionExpression helpers ──────────────────────────────────────────

/**
 * Build a KeyConditionExpression from a simple where clause restricted to
 * the partition key (and optionally the sort key). Used in Query operations.
 */
export function buildKeyCondition(
  partitionKey: string,
  sortKey: string | undefined,
  where: WhereClause,
  toField: (field: string) => string = (field) => field,
): {
  keyCondition: string;
  filterCondition?: string;
  names: Record<string, string>;
  values: Record<string, AttributeValue>;
} {
  assertOperators(where, DYNAMODB_OPERATORS, "@mantlejs/dynamodb");
  const ctx: BuildContext = { names: {}, values: {}, nameIdx: 0, valIdx: 0 };
  const keyParts: string[] = [];
  const filterParts: string[] = [];

  for (const [key, value] of Object.entries(where)) {
    if (key === partitionKey || key === sortKey) {
      const mappedKey = toField(key);
      const n = nameAlias(mappedKey, ctx);
      if (value === null || Array.isArray(value)) {
        // null / array not valid in key condition — treat as filter
        filterParts.push(buildFieldCondition(mappedKey, value, ctx));
      } else if (typeof value === "object") {
        // Operators — supported for sort key in key condition
        keyParts.push(buildOperators(n, mappedKey, value as Record<string, unknown>, ctx));
      } else {
        const v = valueAlias(value, ctx);
        keyParts.push(`${n} = ${v}`);
      }
    } else if (key === "$or" || key === "$and") {
      const logicalOp = key === "$or" ? "OR" : "AND";
      filterParts.push(buildLogical(value as unknown as WhereClause[], logicalOp as "OR" | "AND", ctx, toField));
    } else {
      filterParts.push(buildFieldCondition(toField(key), value, ctx));
    }
  }

  return {
    keyCondition: keyParts.join(" AND "),
    filterCondition: filterParts.length > 0 ? filterParts.join(" AND ") : undefined,
    names: ctx.names,
    values: ctx.values,
  };
}

// ─── Legacy Condition type helper (for older SDK usage) ───────────────────────

/**
 * Convert a simple equality where clause to the legacy `Condition` map
 * used by the AWS SDK v3's older API shapes.
 * @internal
 */
export function toConditionMap(where: WhereClause): Record<string, Condition> {
  const result: Record<string, Condition> = {};
  for (const [key, value] of Object.entries(where)) {
    if (value === null || Array.isArray(value) || typeof value === "object") continue;
    result[key] = {
      ComparisonOperator: "EQ",
      AttributeValueList: [marshall({ v: value })["v"] as AttributeValue],
    };
  }
  return result;
}
