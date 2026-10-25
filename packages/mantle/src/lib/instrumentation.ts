import type { HookContext, HookFunction, MantleApplication } from "./types.js";

/** The hook-pipeline phase a hook runs in. */
export type HookPhase = "before" | "after" | "error";

/**
 * Observes every service call on an app — the seam tracing (`@mantlejs/otel`) and metrics plugins hang
 * on, since per-service `hooks()` can't wrap a whole call. Register with `addInstrumentation()`.
 */
export interface ServiceInstrumentation {
  /**
   * Called once per service call, after the hook context is built and before any hook runs. Return
   * undefined to leave this call unobserved.
   */
  start(context: HookContext): CallInstrumentation | undefined;
}

/** One observed service call, from `ServiceInstrumentation.start()`. */
export interface CallInstrumentation {
  /**
   * Runs the call's whole pipeline (hooks, service method, event emission) — e.g. with a span active,
   * so service calls made from inside a hook become its children. Must return what `fn` returns.
   */
  run<R>(fn: () => Promise<R>): Promise<R>;
  /** Called after each hook settles, with the error when the hook threw. */
  hook?(phase: HookPhase, hook: HookFunction, error?: unknown): void;
  /**
   * Called once when the call settles, with the final context. `error` is what the caller receives;
   * it is undefined when the call succeeded, including when an error hook recovered from a failure.
   */
  end(context: HookContext, error?: unknown): void;
}

const INSTRUMENTATION_SETTING = "mantle:instrumentation";

/** Register `instrumentation` to observe every service call on `app`. Registrations run in order, outermost first. */
export function addInstrumentation(app: MantleApplication, instrumentation: ServiceInstrumentation): void {
  const existing = app.get<ServiceInstrumentation[] | undefined>(INSTRUMENTATION_SETTING) ?? [];
  app.set(INSTRUMENTATION_SETTING, [...existing, instrumentation]);
}

/** The observers for one call — empty (the common case) when nothing is registered. */
export function startInstrumentation(app: MantleApplication, context: HookContext): CallInstrumentation[] {
  const registered = app.get<ServiceInstrumentation[] | undefined>(INSTRUMENTATION_SETTING);
  if (!registered) return [];
  return registered
    .map((instrumentation) => instrumentation.start(context))
    .filter((call): call is CallInstrumentation => call !== undefined);
}
