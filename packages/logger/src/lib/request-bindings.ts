import type { RequestContext } from "@mantlejs/mantle";
import { parseTraceparent } from "@mantlejs/mantle";

/**
 * The fields a log record takes from the current request context: everything in it, except that the
 * raw `traceparent` / `tracestate` headers become `traceId` and `spanId` (the caller's span), the
 * fields log backends join against traces.
 */
export function requestBindings(context: RequestContext | undefined): Record<string, unknown> {
  if (!context) return {};
  const rest: RequestContext = { ...context };
  delete rest.traceparent;
  delete rest.tracestate;
  const parsed = parseTraceparent(context.traceparent);
  return parsed ? { ...rest, traceId: parsed.traceId, spanId: parsed.spanId } : rest;
}
