import type { MantleError } from "@mantlejs/mantle";
import {
  BadRequest,
  Conflict,
  Forbidden,
  GeneralError,
  MantleError as MantleErrorClass,
  MethodNotAllowed,
  NotAuthenticated,
  NotFound,
  NotImplemented,
  TooManyRequests,
  Unavailable,
  Unprocessable,
} from "@mantlejs/mantle";
import { CodeExecutorFault, CodeLimitExceeded, CodeOutputTooLarge, CodeScriptError, CodeTimeout } from "./errors.js";

type ErrorClass = new (message?: string, data?: unknown, errors?: unknown[], hint?: string) => MantleError;

/** Every typed error that can cross the sandbox boundary, by `name` — rebuilt as its real class on the way out. */
const ERROR_CLASSES: Record<string, ErrorClass> = {
  BadRequest,
  NotAuthenticated,
  Forbidden,
  NotFound,
  MethodNotAllowed,
  Conflict,
  Unprocessable,
  TooManyRequests,
  GeneralError,
  NotImplemented,
  Unavailable,
  CodeTimeout,
  CodeLimitExceeded,
  CodeOutputTooLarge,
  CodeScriptError,
  CodeExecutorFault,
};

/** `MantleError.toJSON()` for anything thrown on the host — plain errors map to the GeneralError shape (as tool mode does). */
export function toErrorJson(error: unknown): Record<string, unknown> {
  if (error instanceof MantleErrorClass) return error.toJSON();
  const message = error instanceof Error ? error.message : String(error);
  return { name: "GeneralError", message, code: 500, className: "general-error" };
}

/**
 * Rebuild a typed error from the JSON shape an uncaught script error carries. A Mantle service
 * error the script didn't catch (e.g. a `Forbidden` from a hook) comes back as that same class,
 * so the tool error reads exactly like tool mode's; anything else (a `TypeError`, a syntax
 * error, a plain `throw`) is the script's own failure → `CodeScriptError`.
 */
export function errorFromJson(json: Record<string, unknown>): MantleError {
  const name = typeof json["name"] === "string" ? json["name"] : "Error";
  const message = typeof json["message"] === "string" ? json["message"] : String(json["message"] ?? "");
  const hint = typeof json["hint"] === "string" ? json["hint"] : undefined;
  const ErrorClass = ERROR_CLASSES[name];
  if (ErrorClass !== undefined && typeof json["className"] === "string") {
    return new ErrorClass(message, json["data"], undefined, hint);
  }
  const stack = typeof json["stack"] === "string" ? json["stack"] : undefined;
  return new CodeScriptError(
    `${name}: ${message}`,
    stack !== undefined ? { stack } : undefined,
    undefined,
    "The script threw. Script line numbers match your code; fix the error and run it again.",
  );
}
