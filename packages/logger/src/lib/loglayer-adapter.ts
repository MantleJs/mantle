import { getContext } from "@mantlejs/mantle";
import type { Logger } from "@mantlejs/mantle";

/** Duck-type of a LogLayer instance — no dependency on the `loglayer` package. */
export interface LogLayerLike {
  withMetadata(meta: Record<string, unknown>): {
    debug(msg: string): void;
    info(msg: string): void;
    warn(msg: string): void;
    error(msg: string): void;
  };
  child?(): unknown;
}

type Level = "debug" | "info" | "warn" | "error";

/**
 * Wraps a LogLayer instance to satisfy the Mantle Logger interface.
 * Merges the current RequestContext into `withMetadata()` on every call.
 * `child(bindings)` closes over merged bindings rather than using LogLayer's own
 * `child()` (whose semantics differ) — bindings are folded into every `withMetadata` call.
 */
export function loglayerAdapter(log: LogLayerLike): Logger {
  function build(baseBindings: Record<string, unknown>): Logger {
    const call =
      (level: Level) =>
      (msg: string, context?: Record<string, unknown>): void => {
        const reqCtx = getContext();
        const merged = { ...baseBindings, ...(reqCtx ?? {}), ...(context ?? {}) };
        log.withMetadata(merged)[level](msg);
      };

    return {
      debug: call("debug"),
      info: call("info"),
      warn: call("warn"),
      error: call("error"),
      child: (bindings: Record<string, unknown>): Logger => build({ ...baseBindings, ...bindings }),
    };
  }

  return build({});
}
