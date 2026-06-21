import "./lib/formats.js";

export { Type, Kind, Hint, FormatRegistry } from "@sinclair/typebox";
export type { Static, TSchema, TObject, TString, TNumber, TBoolean, TArray, TOptional } from "@sinclair/typebox";

export { validate } from "./lib/validate.js";
export type { ValidateOptions } from "./lib/validate.js";

export { resolver } from "./lib/resolver.js";
export type { ResolverMap, FieldResolver } from "./lib/resolver.js";
