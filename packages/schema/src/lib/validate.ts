import { Value } from "@sinclair/typebox/value";
import type { TSchema } from "@sinclair/typebox";
import { Unprocessable } from "@mantlejs/core";
import type { HookFunction } from "@mantlejs/core";

export interface ValidateOptions {
  /** Source to validate. Default: 'data' */
  target?: "data" | "result" | "query";
  /** Coerce input types to schema types before validation. Default: false */
  coerce?: boolean;
  /** Remove properties absent from the schema before validation. Default: false */
  stripAdditional?: boolean;
}

/** Validates context.data, context.result, or context.params.query against a TypeBox schema. */
export function validate<T extends TSchema>(schema: T, options: ValidateOptions = {}): HookFunction {
  const { target = "data", coerce = false, stripAdditional = false } = options;

  return function validateHook(ctx) {
    let value: unknown;
    if (target === "data") value = ctx.data;
    else if (target === "result") value = ctx.result;
    else value = ctx.params.query;

    if (value === undefined || value === null) return ctx;

    if (coerce) value = Value.Convert(schema, value);
    if (stripAdditional) value = Value.Clean(schema, Value.Clone(value));

    if (!Value.Check(schema, value)) {
      const errors = Array.from(Value.Errors(schema, value)).map((e) => ({
        field: e.path,
        message: e.message,
      }));
      throw new Unprocessable("Validation failed", { errors });
    }

    if (coerce || stripAdditional) {
      if (target === "data") ctx.data = value as typeof ctx.data;
      else if (target === "result") ctx.result = value as typeof ctx.result;
      else ctx.params.query = value as Record<string, unknown>;
    }

    return ctx;
  };
}
