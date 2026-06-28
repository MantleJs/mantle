import type { HookFunction, Logger } from "@mantlejs/mantle";

export interface LogRequestOptions {
  /** Log level for successful calls. Default: 'debug' */
  level?: "debug" | "info";
  /** Include params in the log record. Default: false — may contain sensitive data */
  includeParams?: boolean;
}

/**
 * Returns a hook that logs service call duration.
 * Register the same returned function in before.all, after.all, AND error.all.
 * The first invocation (before phase) records the start time; the second
 * (after or error phase) emits the log record with elapsed duration and status.
 */
export function logRequest(options: LogRequestOptions = {}): HookFunction {
  const { level = "debug", includeParams = false } = options;
  const timers = new WeakMap<object, number>();

  return function logRequestHook(ctx) {
    const log = ctx.app.get<Logger | undefined>("logger");
    if (!log) return ctx;

    if (!timers.has(ctx)) {
      timers.set(ctx, Date.now());
    } else {
      const start = timers.get(ctx)!;
      timers.delete(ctx);
      const record: Record<string, unknown> = {
        component: "mantle:request",
        method: ctx.method,
        path: ctx.path,
        provider: ctx.provider,
        durationMs: Date.now() - start,
        status: ctx.error ? "error" : "ok",
      };
      if (ctx.id !== undefined) record["id"] = ctx.id;
      if (includeParams) record["params"] = ctx.params;
      const msg = ctx.error ? "Service call failed" : "Service call completed";
      log[level](msg, record);
    }

    return ctx;
  };
}
