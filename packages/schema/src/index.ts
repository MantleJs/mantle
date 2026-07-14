export { Type, Kind, Hint, FormatRegistry } from "@sinclair/typebox";
export type { Static, TSchema, TObject, TString, TNumber, TBoolean, TArray, TOptional } from "@sinclair/typebox";

export { validate } from "./lib/validate.js";
export type { ValidateOptions, ValidatorFn } from "./lib/validate.js";

export { querySyntax } from "./lib/query-syntax.js";
export type { QuerySyntaxOptions } from "./lib/query-syntax.js";

export { resolver } from "./lib/resolver.js";
export type { ResolverMap, FieldResolver, ResolverOptions } from "./lib/resolver.js";
