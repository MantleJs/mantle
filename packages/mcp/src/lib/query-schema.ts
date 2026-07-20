type JsonObject = Record<string, unknown>;

/** Operators that take an array of where clauses rather than appearing under a field. */
const LOGICAL_OPERATORS = ["$or", "$and"];

/**
 * JSON Schema for the `query` argument of generated `find`/`get`/`remove` tools.
 *
 * The shape is the structured `QueryParams` form (`where`/`limit`/`skip`/`sort`/`select`) —
 * friendlier to schema-driven callers than the REST `$`-prefixed convention; the dispatch
 * layer translates. When the service's repository reports its supported operators via
 * `describe().capabilities.operators`, the per-field operator object is closed over exactly
 * that set, so a caller is never offered an operator the adapter would reject.
 */
export function buildQuerySchema(
  operators: string[] | undefined,
  limits?: { defaultLimit: number; maxLimit: number },
): JsonObject {
  const fieldOperators = operators?.filter((op) => !LOGICAL_OPERATORS.includes(op));

  // Field value: a literal (equality / null → IS NULL) or an operator object.
  const fieldSchema: JsonObject = fieldOperators
    ? {
        anyOf: [
          { description: "Literal for equality; null matches IS NULL." },
          {
            type: "object",
            description: `Operator object. Supported: ${fieldOperators.join(", ")}.`,
            properties: Object.fromEntries(fieldOperators.map((op) => [op, {}])),
            additionalProperties: false,
          },
        ],
      }
    : { description: "Literal for equality, or an operator object (e.g. { \"$gt\": 21 })." };

  const whereProperties: JsonObject = {};
  if (!operators || operators.includes("$or")) {
    whereProperties["$or"] = { type: "array", items: { type: "object" }, description: "Any clause may match." };
  }
  if (!operators || operators.includes("$and")) {
    whereProperties["$and"] = { type: "array", items: { type: "object" }, description: "All clauses must match." };
  }

  const schema: JsonObject = {
    type: "object",
    additionalProperties: false,
    properties: {
      where: {
        type: "object",
        description: "Filter clause. Keys are field names; values are literals or operator objects.",
        properties: whereProperties,
        additionalProperties: fieldSchema,
      },
      skip: { type: "integer", minimum: 0, description: "Number of records to skip (offset pagination)." },
      sort: {
        type: "object",
        additionalProperties: { enum: ["asc", "desc"] },
        description: "Sort order per field.",
      },
      select: {
        type: "array",
        items: { type: "string" },
        description: "Fields to return. Use to keep results small.",
      },
      ...(limits
        ? {
            limit: {
              type: "integer",
              minimum: 1,
              maximum: limits.maxLimit,
              description: `Maximum records to return. Default ${limits.defaultLimit}; requests above ${limits.maxLimit} are clamped. Page with skip.`,
            },
          }
        : {}),
    },
  };
  return schema;
}
