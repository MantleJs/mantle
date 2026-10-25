import type { Attributes, Context, Span, Tracer, TracerProvider } from "@opentelemetry/api";
import {
  context as otelContext,
  createTraceState,
  SpanKind,
  SpanStatusCode,
  trace,
  TraceFlags,
} from "@opentelemetry/api";
import type { CallInstrumentation, HookContext, MantlePlugin, ServiceInstrumentation } from "@mantlejs/mantle";
import { addInstrumentation, getContext, MantleError, parseTraceparent } from "@mantlejs/mantle";

export interface OtelOptions {
  /**
   * Where spans go. Defaults to the global provider (`trace.getTracerProvider()`), which is a no-op until an
   * OpenTelemetry SDK registers one — so without an SDK, `otel()` costs next to nothing.
   */
  tracerProvider?: TracerProvider;
  /** Return false to leave a call untraced — e.g. a health-check service, or internal calls. Default: trace every call. */
  filter?: (context: HookContext) => boolean;
  /** Add a span event per before/after/error hook. Default true. */
  hookEvents?: boolean;
}

/** The instrumentation scope spans are reported under. */
const TRACER_NAME = "@mantlejs/otel";

/**
 * Trace every service call: `.configure(otel())` wraps each call's hook pipeline in a span named
 * `mantle.service <path>.<method>`, parented on the active span (so internal calls nest under the call that
 * made them), else on the request's `traceparent`. Hooks become span events; errors set the span status.
 */
export function otel(options: OtelOptions = {}): MantlePlugin {
  return (app) => addInstrumentation(app, otelInstrumentation(options));
}

/** The `ServiceInstrumentation` behind `otel()`, for apps that register instrumentation themselves. */
export function otelInstrumentation(options: OtelOptions = {}): ServiceInstrumentation {
  const hookEvents = options.hookEvents ?? true;
  let tracer: Tracer | undefined;
  // Resolved on first use, so an SDK registered after `.configure(otel())` still receives spans.
  const getTracer = (): Tracer =>
    (tracer ??= (options.tracerProvider ?? trace.getTracerProvider()).getTracer(TRACER_NAME));

  return {
    start(context: HookContext): CallInstrumentation | undefined {
      if (options.filter && !options.filter(context)) return undefined;
      const active = otelContext.active();
      const hasLocalParent = trace.getSpan(active) !== undefined;
      const parent = hasLocalParent ? active : (remoteParent(active, context) ?? active);
      // A call with no span above it is where this process's work on the request starts.
      const kind = !hasLocalParent && context.provider !== undefined ? SpanKind.SERVER : SpanKind.INTERNAL;
      const span = getTracer().startSpan(
        `mantle.service ${context.path}.${context.method}`,
        { kind, attributes: startAttributes(context) },
        parent,
      );
      const spanContext = trace.setSpan(parent, span);

      return {
        run: (fn) => otelContext.with(spanContext, fn),
        hook: hookEvents
          ? (phase, hook, error) => {
              span.addEvent("mantle.hook", {
                "mantle.hook.phase": phase,
                "mantle.hook.name": hook.name || "anonymous",
                ...(error !== undefined ? { "mantle.hook.error": true } : {}),
              });
            }
          : undefined,
        end: (final, error) => {
          if (final.agent) span.setAttribute("mantle.agent.id", final.agent.id);
          if (error !== undefined) recordError(span, kind, error);
          span.end();
        },
      };
    },
  };
}

function startAttributes(context: HookContext): Attributes {
  const attributes: Attributes = { "mantle.path": context.path, "mantle.method": context.method };
  if (context.provider !== undefined) attributes["mantle.provider"] = context.provider;
  if (context.params.requestId !== undefined) attributes["mantle.request.id"] = context.params.requestId;
  return attributes;
}

/** The incoming request's trace as a remote parent — from params, else the request context an internal call inherits. */
function remoteParent(active: Context, context: HookContext): Context | undefined {
  const request = context.params.traceparent !== undefined ? context.params : getContext();
  const parsed = parseTraceparent(request?.traceparent);
  if (!parsed) return undefined;
  return trace.setSpanContext(active, {
    traceId: parsed.traceId,
    spanId: parsed.spanId,
    traceFlags: parsed.sampled ? TraceFlags.SAMPLED : TraceFlags.NONE,
    isRemote: true,
    traceState: request?.tracestate !== undefined ? createTraceState(request.tracestate) : undefined,
  });
}

/**
 * Record a failed call. Following the OpenTelemetry HTTP conventions, a 4xx on a SERVER span is the caller's
 * mistake, not a server fault, so it leaves the status unset; every other error marks the span as an error.
 */
function recordError(span: Span, kind: SpanKind, error: unknown): void {
  const code = error instanceof MantleError ? error.code : undefined;
  span.setAttribute("error.type", error instanceof Error ? error.name : "Error");
  if (code !== undefined) span.setAttribute("mantle.error.code", code);
  span.recordException(error instanceof Error ? error : String(error));
  if (kind === SpanKind.SERVER && code !== undefined && code >= 400 && code < 500) return;
  span.setStatus({ code: SpanStatusCode.ERROR, message: error instanceof Error ? error.message : String(error) });
}
