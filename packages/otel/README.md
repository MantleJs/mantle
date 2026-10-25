# @mantlejs/otel

OpenTelemetry tracing for [Mantle JS](https://github.com/mantlejs/mantle): `.configure(otel())` puts a span around
every service call, parented on the caller's [W3C `traceparent`](https://www.w3.org/TR/trace-context/), so a request
shows up in your tracing backend from the gateway through each service call to the database driver.

---

## Installation

```bash
npm install @mantlejs/otel @opentelemetry/api
```

`@opentelemetry/api` is a peer dependency. Without an OpenTelemetry SDK registered it is a no-op, so `otel()` costs
next to nothing until you add one.

---

## Quick start

Register an SDK before the app starts, then configure `otel()` like any other plugin:

```typescript
// tracing.ts — import this first
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";

new NodeSDK({ serviceName: "notes-api", traceExporter: new OTLPTraceExporter() }).start();
```

```typescript
import { mantle } from "@mantlejs/mantle";
import { http } from "@mantlejs/http";
import { otel } from "@mantlejs/otel";

const app = mantle().configure(http()).configure(otel());
```

A `GET /notes/42` sent with

```http
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
```

records a span `mantle.service notes.get` in trace `4bf92f35…`, as a child of the caller's span `00f067aa…`.

---

## Spans

| Field               | Value                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------- |
| Name                | `mantle.service <path>.<method>`, e.g. `mantle.service notes.get`                             |
| Kind                | `SERVER` for a transport call with no span above it; `INTERNAL` otherwise                     |
| `mantle.path`       | The service path                                                                              |
| `mantle.method`     | `find`, `get`, `create`, … or a custom method                                                 |
| `mantle.provider`   | `rest`, `koa`, `http`, `socket.io`, `mcp` — absent on an internal call                        |
| `mantle.request.id` | `params.requestId` (the `X-Request-Id`), when set                                             |
| `mantle.agent.id`   | The agent's ID when [`authorizeAgent()`](../auth/README.md) admitted the call                   |
| `mantle.error.code` | The `MantleError` status code (e.g. `404`) when the call failed                               |
| `error.type`        | The error's class name, e.g. `NotFound`, when the call failed                                 |
| Events              | One `mantle.hook` per hook, with `mantle.hook.phase`, `mantle.hook.name`, `mantle.hook.error` |

The span covers the whole pipeline: before hooks, the service method, after hooks, error hooks, and the realtime
event. Hook names come from the function's `name`, so give hooks named functions (`const audit: HookFunction = …`)
to tell them apart; anonymous ones show as `anonymous`.

**Parentage**, in order:

1. The active span. A service call made from inside a hook nests under the call that made it, and when an HTTP
   instrumentation (e.g. `@opentelemetry/instrumentation-http`) already opened a server span, Mantle's span is its
   child.
2. `params.traceparent` / `params.tracestate`, which express, koa, and http set from the request headers.
3. The request context's `traceparent` (`getContext()`), which internal calls inherit.
4. Otherwise a new trace.

Nesting under the active span needs a context manager, which `NodeSDK` registers for you. Without one, internal
calls still join the request's trace (step 3), as siblings rather than children.

**Errors** record the exception and `mantle.error.code`. Following the OpenTelemetry HTTP conventions, a 4xx on a
`SERVER` span is the caller's mistake and leaves the span status unset; every other failure — a 5xx, a non-Mantle
error, or a 4xx from an internal call — sets the status to `ERROR`. A failure an error hook recovers from is a success.

Repositories aren't instrumented: the database drivers (`pg`, `mysql2`, `mongodb`, …) have their own OpenTelemetry
instrumentation, and their spans nest under Mantle's.

---

## Options

```typescript
otel({
  tracerProvider, // default: the global provider (trace.getTracerProvider())
  filter: (context) => context.path !== "health", // return false to skip a call
  hookEvents: false, // drop the per-hook span events
});
```

| Option           | Default                     | Description                                                                  |
| ---------------- | --------------------------- | ---------------------------------------------------------------------------- |
| `tracerProvider` | `trace.getTracerProvider()` | Where spans go. Resolved on the first call, so an SDK registered later works |
| `filter`         | trace every call            | `(context: HookContext) => boolean` — return `false` to skip the call        |
| `hookEvents`     | `true`                      | Add a `mantle.hook` event per hook                                           |

`otelInstrumentation(options)` returns the underlying `ServiceInstrumentation`, for registering it yourself with
`addInstrumentation()` from `@mantlejs/mantle`.

---

## Logs

`@mantlejs/logger` adds `traceId` and `spanId` (the caller's span, from `traceparent`) to every log line written during
a request, so a backend can jump from a log line to its trace. This works with or without `otel()`.

---

## License

MIT
