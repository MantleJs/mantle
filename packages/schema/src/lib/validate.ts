import { Ajv, type ValidateFunction } from "ajv";
import * as ajvFormatsNS from "ajv-formats";
import { Value } from "@sinclair/typebox/value";
import type { TSchema } from "@sinclair/typebox";
import { Unprocessable } from "@mantlejs/mantle";
import type { HookFunction } from "@mantlejs/mantle";

// ajv-formats ships without an "exports" field so TypeScript's moduleResolution:nodenext
// cannot resolve its default callable from the module namespace type. Cast explicitly.
type AjvFormatsPlugin = (ajv: InstanceType<typeof Ajv>) => InstanceType<typeof Ajv>;
const addFormats = (ajvFormatsNS as unknown as { default: AjvFormatsPlugin }).default;

// Single Ajv instance with RFC-compliant format implementations via ajv-formats.
// strict: false — TypeBox schemas carry symbol-keyed metadata that Ajv ignores,
// but some edge-case TypeBox keywords would trigger strict-mode warnings.
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

// Compiled validators are cached by schema object reference — compilation is
// expensive and schemas are created once at module load, so this is safe.
const cache = new WeakMap<object, ValidateFunction>();

function compiled(schema: TSchema): ValidateFunction {
  const cached = cache.get(schema);
  if (cached) return cached;
  const fn = ajv.compile(schema);
  cache.set(schema, fn);
  return fn;
}

/** Custom validator function for the BYOV overload of validate(). */
export type ValidatorFn = (data: unknown) => Array<{ field: string; message: string }> | null | undefined;

export interface ValidateOptions {
  /** Source to validate. Default: 'data' */
  target?: "data" | "result" | "query";
  /** Coerce input types to schema types before validation (e.g. "42" → 42). Default: false */
  coerce?: boolean;
  /** Remove properties absent from the schema before validation. Default: false */
  stripAdditional?: boolean;
}

export function validate<T extends TSchema>(schema: T, options?: ValidateOptions): HookFunction;
export function validate(validator: ValidatorFn, options?: Pick<ValidateOptions, "target">): HookFunction;
export function validate(schemaOrValidator: TSchema | ValidatorFn, options: ValidateOptions = {}): HookFunction {
  const { target = "data", coerce = false, stripAdditional = false } = options;

  return function validateHook(ctx) {
    let value: unknown;
    if (target === "data") value = ctx.data;
    else if (target === "result") value = ctx.result;
    else value = ctx.params.query;

    if (value === undefined || value === null) return ctx;

    // BYOV path — delegate entirely to the custom validator function
    if (typeof schemaOrValidator === "function") {
      const errors = schemaOrValidator(value);
      if (errors && errors.length > 0) {
        throw new Unprocessable("Validation failed", { errors });
      }
      return ctx;
    }

    // TypeBox + Ajv path
    // Value.Convert and Value.Clean are TypeBox utilities — coerce/strip happen
    // before Ajv validates so the validator sees the final transformed value.
    if (coerce) value = Value.Convert(schemaOrValidator, value);
    if (stripAdditional) value = Value.Clean(schemaOrValidator, Value.Clone(value));

    const fn = compiled(schemaOrValidator);
    if (!fn(value)) {
      const errors = (fn.errors ?? []).map((e) => ({
        field: e.instancePath,
        message: e.message ?? "invalid",
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
