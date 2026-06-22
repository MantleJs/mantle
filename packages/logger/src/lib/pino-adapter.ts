import { getContext } from "@mantlejs/core";
import type { Logger } from "@mantlejs/core";

/** Minimal duck-type for a pino logger. Accepts pino.Logger or any compatible object. */
export interface PinoLike {
  debug(obj: object, msg: string): void;
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

/**
 * Wraps a pino logger to satisfy the Mantle Logger interface.
 * Pino uses (obj, msg) argument order; the Logger interface uses (msg, obj).
 * Automatically merges the current RequestContext (correlationId, etc.) into every log record.
 */
export function pinoAdapter(pino: PinoLike): Logger {
  const wrap =
    (fn: (obj: object, msg: string) => void) =>
    (msg: string, context?: Record<string, unknown>): void => {
      const reqCtx = getContext();
      const merged = reqCtx ? { ...reqCtx, ...(context ?? {}) } : (context ?? {});
      fn(merged, msg);
    };

  return {
    debug: wrap(pino.debug.bind(pino)),
    info: wrap(pino.info.bind(pino)),
    warn: wrap(pino.warn.bind(pino)),
    error: wrap(pino.error.bind(pino)),
  };
}
