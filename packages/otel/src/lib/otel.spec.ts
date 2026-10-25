import { context, SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import type { HookContext, HookFunction, MantleApplication } from "@mantlejs/mantle";
import { BadRequest, createRequestContext, GeneralError, mantle, withContext } from "@mantlejs/mantle";
import { http } from "@mantlejs/http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { otel } from "./otel.js";

const TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736";
const CALLER_SPAN_ID = "00f067aa0ba902b7";
const TRACEPARENT = `00-${TRACE_ID}-${CALLER_SPAN_ID}-01`;

const exporter = new InMemorySpanExporter();
const tracerProvider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });

function spans(): ReadableSpan[] {
  return exporter.getFinishedSpans();
}

function span(name: string): ReadableSpan {
  const found = spans().find((s) => s.name === name);
  if (!found)
    throw new Error(
      `no span named ${name}; got ${spans()
        .map((s) => s.name)
        .join(", ")}`,
    );
  return found;
}

function app(options: Parameters<typeof otel>[0] = {}): MantleApplication {
  const instance = mantle().configure(otel({ tracerProvider, ...options }));
  instance.use<{ id: string }>(
    "notes",
    {
      async get(id) {
        if (id === "missing") throw new BadRequest("No such note");
        if (id === "crash") throw new GeneralError("Database down");
        return { id: String(id) };
      },
      async find() {
        return [];
      },
    },
    { methods: ["get", "find"] },
  );
  instance.use(
    "users",
    {
      async get(id) {
        return { id };
      },
    },
    { methods: ["get"] },
  );
  return instance;
}

beforeAll(() => {
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
});

afterAll(() => {
  context.disable();
});

beforeEach(() => {
  exporter.reset();
});

describe("otel()", () => {
  it("wraps a service call in a span named after its path and method, with Mantle attributes", async () => {
    await app().service("notes").get("1", { provider: "rest", requestId: "req-1" });

    const s = span("mantle.service notes.get");
    expect(s.kind).toBe(SpanKind.SERVER);
    expect(s.attributes).toMatchObject({
      "mantle.path": "notes",
      "mantle.method": "get",
      "mantle.provider": "rest",
      "mantle.request.id": "req-1",
    });
    expect(s.status.code).toBe(SpanStatusCode.UNSET);
    expect(s.instrumentationScope.name).toBe("@mantlejs/otel");
  });

  it("makes an internal call with no span above it an INTERNAL root span", async () => {
    await app().service("notes").get("1");

    const s = span("mantle.service notes.get");
    expect(s.kind).toBe(SpanKind.INTERNAL);
    expect(s.parentSpanContext).toBeUndefined();
    expect(s.attributes["mantle.provider"]).toBeUndefined();
  });

  it("parents the span on params.traceparent and carries tracestate", async () => {
    await app().service("notes").get("1", { provider: "rest", traceparent: TRACEPARENT, tracestate: "rojo=1" });

    const s = span("mantle.service notes.get");
    expect(s.spanContext().traceId).toBe(TRACE_ID);
    expect(s.parentSpanContext?.spanId).toBe(CALLER_SPAN_ID);
    expect(s.parentSpanContext?.isRemote).toBe(true);
    expect(s.spanContext().traceState?.get("rojo")).toBe("1");
  });

  it("starts a new trace when there is no traceparent", async () => {
    await app().service("notes").get("1", { provider: "rest" });
    expect(span("mantle.service notes.get").spanContext().traceId).not.toBe(TRACE_ID);
  });

  it("nests a service call made from a hook under the call that made it", async () => {
    const instance = app();
    const loadOwner: HookFunction = async (ctx: HookContext) => {
      await ctx.app.service("users").get("u1");
      return ctx;
    };
    instance.service("notes").hooks({ before: { get: [loadOwner] } });

    await instance.service("notes").get("1", { provider: "rest", traceparent: TRACEPARENT });

    const outer = span("mantle.service notes.get");
    const inner = span("mantle.service users.get");
    expect(inner.parentSpanContext?.spanId).toBe(outer.spanContext().spanId);
    expect(inner.spanContext().traceId).toBe(TRACE_ID);
    expect(inner.kind).toBe(SpanKind.INTERNAL);
  });

  it("parents an internal call on the request context's traceparent when no span is active", async () => {
    await withContext(createRequestContext("req-1", { traceparent: TRACEPARENT }), () =>
      app().service("users").get("u1"),
    );
    expect(span("mantle.service users.get").parentSpanContext?.spanId).toBe(CALLER_SPAN_ID);
  });

  it("nests under a span already active from another instrumentation (e.g. the HTTP server's)", async () => {
    const outer = tracerProvider.getTracer("test").startSpan("GET /notes/1");
    await context.with(trace.setSpan(context.active(), outer), () =>
      app().service("notes").get("1", { provider: "rest", traceparent: TRACEPARENT }),
    );
    outer.end();

    const s = span("mantle.service notes.get");
    expect(s.parentSpanContext?.spanId).toBe(outer.spanContext().spanId);
    expect(s.kind).toBe(SpanKind.INTERNAL);
  });

  it("adds an event per hook, flagging the one that threw", async () => {
    const instance = app();
    const authenticate: HookFunction = (ctx) => ctx;
    const sanitize: HookFunction = (ctx) => ctx;
    instance.service("notes").hooks({ before: { all: [authenticate] }, after: { all: [sanitize] } });
    await instance.service("notes").get("1");

    expect(span("mantle.service notes.get").events.map((e) => [e.name, e.attributes])).toEqual([
      ["mantle.hook", { "mantle.hook.phase": "before", "mantle.hook.name": "authenticate" }],
      ["mantle.hook", { "mantle.hook.phase": "after", "mantle.hook.name": "sanitize" }],
    ]);

    exporter.reset();
    const deny: HookFunction = () => {
      throw new BadRequest("nope");
    };
    instance.service("notes").hooks({ before: { all: [deny] } });
    await expect(instance.service("notes").get("1")).rejects.toThrow("nope");
    const hookEvent = span("mantle.service notes.get").events.find((e) => e.name === "mantle.hook");
    expect(hookEvent?.attributes).toEqual({
      "mantle.hook.phase": "before",
      "mantle.hook.name": "deny",
      "mantle.hook.error": true,
    });
  });

  it("omits hook events with hookEvents: false", async () => {
    const instance = app({ hookEvents: false });
    instance.service("notes").hooks({ before: { all: [(ctx: HookContext) => ctx] } });
    await instance.service("notes").get("1");
    expect(span("mantle.service notes.get").events).toEqual([]);
  });

  it("records the agent that made the call", async () => {
    const instance = app();
    const authorize: HookFunction = (ctx) => ({
      ...ctx,
      agent: { id: "agent-7", scope: { notes: true }, delegatingUserId: "u1" },
    });
    instance.service("notes").hooks({ before: { all: [authorize] } });
    await instance.service("notes").get("1", { provider: "mcp" });
    expect(span("mantle.service notes.get").attributes["mantle.agent.id"]).toBe("agent-7");
  });

  it("marks a server error as an error, with its code and the exception", async () => {
    await expect(app().service("notes").get("crash", { provider: "rest" })).rejects.toThrow("Database down");

    const s = span("mantle.service notes.get");
    expect(s.status).toEqual({ code: SpanStatusCode.ERROR, message: "Database down" });
    expect(s.attributes).toMatchObject({ "mantle.error.code": 500, "error.type": "GeneralError" });
    expect(s.events.some((e) => e.name === "exception")).toBe(true);
  });

  it("leaves a 4xx on a SERVER span unset, but still records the code", async () => {
    await expect(app().service("notes").get("missing", { provider: "rest" })).rejects.toThrow();

    const s = span("mantle.service notes.get");
    expect(s.status.code).toBe(SpanStatusCode.UNSET);
    expect(s.attributes["mantle.error.code"]).toBe(400);
  });

  it("marks a 4xx on an internal call as an error, since the server made the bad call", async () => {
    await expect(app().service("notes").get("missing")).rejects.toThrow();
    expect(span("mantle.service notes.get").status.code).toBe(SpanStatusCode.ERROR);
  });

  it("reports success when an error hook recovers", async () => {
    const instance = app();
    const fallback: HookFunction = (ctx) => ({ ...ctx, error: undefined, result: { id: "cached" } });
    instance.service("notes").hooks({ error: { get: [fallback] } });

    await expect(instance.service("notes").get("crash", { provider: "rest" })).resolves.toEqual({ id: "cached" });
    expect(span("mantle.service notes.get").status.code).toBe(SpanStatusCode.UNSET);
  });

  it("skips calls the filter rejects", async () => {
    const instance = app({ filter: (ctx) => ctx.path !== "users" });
    await instance.service("users").get("u1");
    await instance.service("notes").get("1");
    expect(spans().map((s) => s.name)).toEqual(["mantle.service notes.get"]);
  });

  it("is a no-op without a registered SDK", async () => {
    const instance = mantle().configure(otel());
    instance.use(
      "notes",
      {
        async get(id) {
          return { id };
        },
      },
      { methods: ["get"] },
    );
    await expect(instance.service("notes").get("1", { traceparent: TRACEPARENT })).resolves.toEqual({ id: "1" });
    expect(spans()).toEqual([]);
  });
});

describe("otel() over @mantlejs/http", () => {
  it("parents the span on the request's traceparent header end to end", async () => {
    const instance = mantle().configure(http()).configure(otel({ tracerProvider }));
    instance.use(
      "notes",
      {
        async get(id) {
          return { id };
        },
      },
      { methods: ["get"] },
    );
    const fetchHandler = instance.get<(request: Request) => Promise<Response>>("fetchHandler");

    const res = await fetchHandler(
      new Request("http://localhost/notes/1", { headers: { traceparent: TRACEPARENT, "X-Request-Id": "req-9" } }),
    );
    expect(res.status).toBe(200);

    const s = span("mantle.service notes.get");
    expect(s.kind).toBe(SpanKind.SERVER);
    expect(s.spanContext().traceId).toBe(TRACE_ID);
    expect(s.parentSpanContext?.spanId).toBe(CALLER_SPAN_ID);
    expect(s.attributes).toMatchObject({ "mantle.provider": "http", "mantle.request.id": "req-9" });
  });

  it("ignores a malformed traceparent and starts a new trace", async () => {
    const instance = mantle().configure(http()).configure(otel({ tracerProvider }));
    instance.use(
      "notes",
      {
        async get(id) {
          return { id };
        },
      },
      { methods: ["get"] },
    );
    const fetchHandler = instance.get<(request: Request) => Promise<Response>>("fetchHandler");

    const res = await fetchHandler(new Request("http://localhost/notes/1", { headers: { traceparent: "garbage" } }));
    expect(res.status).toBe(200);
    expect(span("mantle.service notes.get").parentSpanContext).toBeUndefined();
  });
});
