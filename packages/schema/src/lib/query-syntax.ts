import { Type } from "@sinclair/typebox";
import type { TObject, TSchema } from "@sinclair/typebox";

export interface QuerySyntaxOptions {
  /** Upper bound enforced on `$limit`. Unset means no maximum. */
  maxLimit?: number;
}

/**
 * Derive a query schema from an entity schema, following the `RepositoryService` query
 * convention (Phase 4 TDD §14): every entity field accepts either a bare value or an
 * operator object (`$gt`/`$gte`/`$lt`/`$lte`/`$ne`/`$in`/`$nin`, plus `$like`/`$notlike`/
 * `$ilike` for string fields), and the reserved keys `$limit`, `$skip`, `$sort`, `$select`,
 * `$or`, `$and` are typed to match. Unknown keys are rejected (`additionalProperties: false`).
 *
 * Use it with the validate hook on the query target:
 *
 * ```typescript
 * app.service("users").hooks({
 *   before: { find: [validate(querySyntax(userSchema), { target: "query", coerce: true })] },
 * });
 * ```
 */
export function querySyntax<T extends TObject>(entitySchema: T, options: QuerySyntaxOptions = {}): TObject {
  const fieldProps: Record<string, TSchema> = {};
  const sortProps: Record<string, TSchema> = {};
  const fieldNames = Object.keys(entitySchema.properties);

  for (const [name, fieldSchema] of Object.entries(entitySchema.properties)) {
    fieldProps[name] = Type.Optional(queryProperty(fieldSchema));
    sortProps[name] = Type.Optional(sortDirection());
  }

  const whereClause = Type.Object(fieldProps, { additionalProperties: false });

  return Type.Object(
    {
      ...fieldProps,
      $limit: Type.Optional(
        Type.Integer({ minimum: 0, ...(options.maxLimit !== undefined ? { maximum: options.maxLimit } : {}) }),
      ),
      $skip: Type.Optional(Type.Integer({ minimum: 0 })),
      $sort: Type.Optional(Type.Object(sortProps, { additionalProperties: false })),
      $select: Type.Optional(selectValue(fieldNames)),
      $or: Type.Optional(Type.Array(whereClause)),
      $and: Type.Optional(Type.Array(whereClause)),
    },
    { additionalProperties: false },
  );
}

/** Bare value or operator object, with operator operands typed to the field. */
function queryProperty(field: TSchema): TSchema {
  const operators: Record<string, TSchema> = {
    $gt: Type.Optional(field),
    $gte: Type.Optional(field),
    $lt: Type.Optional(field),
    $lte: Type.Optional(field),
    $ne: Type.Optional(field),
    $in: Type.Optional(Type.Array(field)),
    $nin: Type.Optional(Type.Array(field)),
  };
  if (field.type === "string") {
    operators["$like"] = Type.Optional(Type.String());
    operators["$notlike"] = Type.Optional(Type.String());
    operators["$ilike"] = Type.Optional(Type.String());
  }
  return Type.Union([field, Type.Object(operators, { additionalProperties: false })]);
}

/** Matches the directions RepositoryService.toSort accepts. */
function sortDirection(): TSchema {
  return Type.Union([
    Type.Literal("asc"),
    Type.Literal("desc"),
    Type.Literal("1"),
    Type.Literal("-1"),
    Type.Literal(1),
    Type.Literal(-1),
  ]);
}

/** A single field name or an array of them — only fields declared on the entity. */
function selectValue(fieldNames: string[]): TSchema {
  const name =
    fieldNames.length > 0
      ? Type.Union(fieldNames.map((n) => Type.Literal(n)))
      : (Type.String() as TSchema);
  return Type.Union([name, Type.Array(name)]);
}
