import { MantleError } from "@mantlejs/mantle";
import type { HookFunction, Logger } from "@mantlejs/mantle";
import { redactPaths } from "./redact.js";

export interface LogErrorOptions {
  /** Log 4xx errors as 'warn', 5xx errors as 'error'. Default: true */
  levelByCode?: boolean;
  /** Include stack trace. Default: true when NODE_ENV !== 'production' */
  includeStack?: boolean;
}

/** Error hook. Logs structured error details from ctx.error. */
export function logError(options: LogErrorOptions = {}): HookFunction {
  const { levelByCode = true, includeStack = process.env["NODE_ENV"] !== "production" } = options;

  return function logErrorHook(ctx) {
    const log = ctx.app.get<Logger | undefined>("logger");
    if (!log || !ctx.error) return ctx;

    const err = ctx.error;
    const code = err instanceof MantleError ? err.code : 500;
    const logLevel = levelByCode && code < 500 ? "warn" : "error";

    const record: Record<string, unknown> = {
      component: "mantle:error",
      method: ctx.method,
      path: ctx.path,
      provider: ctx.provider,
      code,
      name: err.name,
      message: err.message,
    };

    if (includeStack) record["stack"] = err.stack;
    if (err instanceof MantleError && err.data !== undefined) record["data"] = redactPaths(err.data);

    log[logLevel]("Service error", record);
    return ctx;
  };
}
