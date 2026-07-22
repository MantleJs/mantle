import { mantle, BadRequest, NotFound, withContext } from "@mantlejs/mantle";
import type { HookContext, Logger, MantleApplication, Service } from "@mantlejs/mantle";
import { logger, pinoAdapter, logRequest, logError } from "../../src/index.js";
import type { PinoLike } from "../../src/index.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeLogger(): Logger & { calls: Record<string, [string, Record<string, unknown> | undefined][]> } {
  const calls: Record<string, [string, Record<string, unknown> | undefined][]> = {
    debug: [],
    info: [],
    warn: [],
    error: [],
  };
  return {
    calls,
    debug: (msg, ctx) => calls["debug"].push([msg, ctx]),
    info: (msg, ctx) => calls["info"].push([msg, ctx]),
    warn: (msg, ctx) => calls["warn"].push([msg, ctx]),
    error: (msg, ctx) => calls["error"].push([msg, ctx]),
  };
}

function makeCtx(app: MantleApplication, overrides: Partial<HookContext> = {}): HookContext {
  return {
    app,
    service: {} as Partial<Service<unknown>>,
    path: "users",
    method: "find",
    params: { provider: "rest" },
    provider: "rest",
    ...overrides,
  };
}

function makeApp(log?: Logger): MantleApplication {
  const app = mantle();
  if (log) app.set("logger", log);
  return app;
}

// ---------------------------------------------------------------------------
// logger() plugin
// ---------------------------------------------------------------------------

describe("logger()", () => {
  it("registers the adapter on the app", () => {
    const app = mantle();
    const adapter = makeLogger();
    app.configure(logger(adapter));
    expect(app.get("logger")).toBe(adapter);
  });

  it("is chainable via configure", () => {
    const app = mantle();
    expect(app.configure(logger(makeLogger()))).toBe(app);
  });
});

// ---------------------------------------------------------------------------
// pinoAdapter()
// ---------------------------------------------------------------------------

describe("pinoAdapter()", () => {
  function makePino(): PinoLike & { calls: { obj: object; msg: string }[] } {
    const calls: { obj: object; msg: string }[] = [];
    return {
      calls,
      debug: (obj, msg) => calls.push({ obj, msg }),
      info: (obj, msg) => calls.push({ obj, msg }),
      warn: (obj, msg) => calls.push({ obj, msg }),
      error: (obj, msg) => calls.push({ obj, msg }),
    };
  }

  it("passes context as first arg and msg as second (pino order)", () => {
    const pino = makePino();
    const adapter = pinoAdapter(pino);
    adapter.info("hello", { component: "test" });
    expect(pino.calls[0]).toEqual({ obj: { component: "test" }, msg: "hello" });
  });

  it("passes empty object when no context is provided", () => {
    const pino = makePino();
    const adapter = pinoAdapter(pino);
    adapter.debug("no-context");
    expect(pino.calls[0]).toEqual({ obj: {}, msg: "no-context" });
  });

  it("delegates all four levels", () => {
    const pino = makePino();
    const adapter = pinoAdapter(pino);
    adapter.debug("d");
    adapter.info("i");
    adapter.warn("w");
    adapter.error("e");
    expect(pino.calls.map((c) => c.msg)).toEqual(["d", "i", "w", "e"]);
  });

  it("merges correlationId from RequestContext when inside withContext", () => {
    const pino = makePino();
    const adapter = pinoAdapter(pino);
    withContext({ correlationId: "req-abc" }, () => {
      adapter.info("hello", { component: "test" });
    });
    expect(pino.calls[0]).toEqual({ obj: { correlationId: "req-abc", component: "test" }, msg: "hello" });
  });

  it("per-call context fields override RequestContext fields", () => {
    const pino = makePino();
    const adapter = pinoAdapter(pino);
    withContext({ correlationId: "req-abc", extra: "from-context" }, () => {
      adapter.info("hello", { correlationId: "override", extra: "from-call" });
    });
    expect(pino.calls[0]?.obj).toMatchObject({ correlationId: "override", extra: "from-call" });
  });

  it("emits empty object when no context and no withContext", () => {
    const pino = makePino();
    const adapter = pinoAdapter(pino);
    adapter.debug("no-context");
    expect(pino.calls[0]).toEqual({ obj: {}, msg: "no-context" });
  });

  it("does not expose child() when the underlying pino-like object lacks it", () => {
    const pino = makePino();
    const adapter = pinoAdapter(pino);
    expect(adapter.child).toBeUndefined();
  });

  it("child() delegates to pino.child(bindings) and re-wraps the result", () => {
    const pino = makePino();
    const childPino = makePino();
    const childSpy = vi.fn((bindings: Record<string, unknown>) => {
      expect(bindings).toEqual({ service: "users" });
      return childPino;
    });
    const adapter = pinoAdapter({ ...pino, child: childSpy });

    const child = adapter.child!({ service: "users" });
    child.info("hello");

    expect(childSpy).toHaveBeenCalledWith({ service: "users" });
    expect(childPino.calls[0]).toEqual({ obj: {}, msg: "hello" });
  });

  it("child() logger still merges RequestContext", () => {
    const pino = makePino();
    const childPino = makePino();
    const adapter = pinoAdapter({ ...pino, child: () => childPino });

    const child = adapter.child!({ service: "users" });
    withContext({ correlationId: "req-abc" }, () => {
      child.info("hello");
    });

    expect(childPino.calls[0]).toEqual({ obj: { correlationId: "req-abc" }, msg: "hello" });
  });
});

// ---------------------------------------------------------------------------
// logRequest()
// ---------------------------------------------------------------------------

describe("logRequest()", () => {
  it("emits no log on the before phase (first call)", () => {
    const log = makeLogger();
    const ctx = makeCtx(makeApp(log));
    const hook = logRequest();
    hook(ctx);
    expect(log.calls["debug"]).toHaveLength(0);
  });

  it("emits a debug record on the after phase (second call) with durationMs", () => {
    const log = makeLogger();
    const ctx = makeCtx(makeApp(log));
    const hook = logRequest();
    hook(ctx);          // before phase
    hook(ctx);          // after phase
    expect(log.calls["debug"]).toHaveLength(1);
    const [msg, record] = log.calls["debug"][0];
    expect(msg).toBe("Service call completed");
    expect(record).toMatchObject({
      component: "mantle:request",
      method: "find",
      path: "users",
      provider: "rest",
      status: "ok",
    });
    expect(typeof record!["durationMs"]).toBe("number");
  });

  it("respects the level option", () => {
    const log = makeLogger();
    const ctx = makeCtx(makeApp(log));
    const hook = logRequest({ level: "info" });
    hook(ctx);
    hook(ctx);
    expect(log.calls["info"]).toHaveLength(1);
    expect(log.calls["debug"]).toHaveLength(0);
  });

  it("excludes params by default", () => {
    const log = makeLogger();
    const ctx = makeCtx(makeApp(log), { params: { provider: "rest", query: { secret: "shh" } } });
    const hook = logRequest();
    hook(ctx);
    hook(ctx);
    expect(log.calls["debug"][0][1]).not.toHaveProperty("params");
  });

  it("includes params when includeParams is true", () => {
    const log = makeLogger();
    const ctx = makeCtx(makeApp(log));
    const hook = logRequest({ includeParams: true });
    hook(ctx);
    hook(ctx);
    expect(log.calls["debug"][0][1]).toHaveProperty("params");
  });

  it("is a no-op when no logger is configured", () => {
    const ctx = makeCtx(makeApp());
    const hook = logRequest();
    expect(() => {
      hook(ctx);
      hook(ctx);
    }).not.toThrow();
  });

  it("each logRequest() call creates an independent timer (multiple services)", () => {
    const log = makeLogger();
    const app = makeApp(log);
    const hookA = logRequest();
    const hookB = logRequest();
    const ctxA = makeCtx(app, { path: "users" });
    const ctxB = makeCtx(app, { path: "posts" });
    hookA(ctxA);
    hookB(ctxB);
    hookA(ctxA);
    hookB(ctxB);
    expect(log.calls["debug"]).toHaveLength(2);
    expect(log.calls["debug"][0][1]!["path"]).toBe("users");
    expect(log.calls["debug"][1][1]!["path"]).toBe("posts");
  });

  it("emits status:error and message 'Service call failed' when ctx.error is set", () => {
    const log = makeLogger();
    const ctx = makeCtx(makeApp(log));
    const hook = logRequest();
    hook(ctx);                                              // before phase
    (ctx as HookContext).error = new BadRequest("bad");    // error phase
    hook(ctx);
    expect(log.calls["debug"]).toHaveLength(1);
    const [msg, record] = log.calls["debug"][0];
    expect(msg).toBe("Service call failed");
    expect(record!["status"]).toBe("error");
    expect(typeof record!["durationMs"]).toBe("number");
  });

  it("includes id in the record when ctx.id is set", () => {
    const log = makeLogger();
    const ctx = makeCtx(makeApp(log), { id: "42" } as Partial<HookContext>);
    const hook = logRequest();
    hook(ctx);
    hook(ctx);
    expect(log.calls["debug"][0][1]!["id"]).toBe("42");
  });

  it("omits id from the record when ctx.id is undefined", () => {
    const log = makeLogger();
    const ctx = makeCtx(makeApp(log));
    const hook = logRequest();
    hook(ctx);
    hook(ctx);
    expect(log.calls["debug"][0][1]).not.toHaveProperty("id");
  });

  it("redacts SENSITIVE_PATHS in params when includeParams is true", () => {
    const log = makeLogger();
    const ctx = makeCtx(makeApp(log), { params: { provider: "rest", query: { password: "shh" } } });
    const hook = logRequest({ includeParams: true });
    hook(ctx);
    hook(ctx);
    const params = log.calls["debug"][0][1]!["params"] as Record<string, unknown>;
    expect((params["query"] as Record<string, unknown>)["password"]).toBe("[Redacted]");
  });

  it("respects a custom redactParams list", () => {
    const log = makeLogger();
    const ctx = makeCtx(makeApp(log), { params: { provider: "rest", query: { secret: "shh" } } });
    const hook = logRequest({ includeParams: true, redactParams: ["*.secret"] });
    hook(ctx);
    hook(ctx);
    const params = log.calls["debug"][0][1]!["params"] as Record<string, unknown>;
    expect((params["query"] as Record<string, unknown>)["secret"]).toBe("[Redacted]");
  });
});

// ---------------------------------------------------------------------------
// logError()
// ---------------------------------------------------------------------------

describe("logError()", () => {
  it("logs at warn level for 4xx errors", () => {
    const log = makeLogger();
    const ctx = makeCtx(makeApp(log), { error: new NotFound("User not found") });
    logError({ includeStack: false })(ctx);
    expect(log.calls["warn"]).toHaveLength(1);
    expect(log.calls["error"]).toHaveLength(0);
    expect(log.calls["warn"][0][1]).toMatchObject({
      component: "mantle:error",
      code: 404,
      name: "NotFound",
      message: "User not found",
    });
  });

  it("logs at error level for 5xx errors", () => {
    const log = makeLogger();
    const ctx = makeCtx(makeApp(log), { error: new Error("Boom") });
    logError({ includeStack: false })(ctx);
    expect(log.calls["error"]).toHaveLength(1);
    expect(log.calls["warn"]).toHaveLength(0);
  });

  it("logs at error level for 4xx when levelByCode is false", () => {
    const log = makeLogger();
    const ctx = makeCtx(makeApp(log), { error: new BadRequest("bad") });
    logError({ levelByCode: false, includeStack: false })(ctx);
    expect(log.calls["error"]).toHaveLength(1);
    expect(log.calls["warn"]).toHaveLength(0);
  });

  it("includes stack when includeStack is true", () => {
    const log = makeLogger();
    const ctx = makeCtx(makeApp(log), { error: new BadRequest("bad") });
    logError({ includeStack: true })(ctx);
    expect(log.calls["warn"][0][1]).toHaveProperty("stack");
  });

  it("excludes stack when includeStack is false", () => {
    const log = makeLogger();
    const ctx = makeCtx(makeApp(log), { error: new BadRequest("bad") });
    logError({ includeStack: false })(ctx);
    expect(log.calls["warn"][0][1]).not.toHaveProperty("stack");
  });

  it("is a no-op when no logger is configured", () => {
    const ctx = makeCtx(makeApp(), { error: new BadRequest("bad") });
    expect(() => logError()(ctx)).not.toThrow();
  });

  it("is a no-op when ctx.error is undefined", () => {
    const log = makeLogger();
    const ctx = makeCtx(makeApp(log));
    logError()(ctx);
    expect(log.calls["warn"]).toHaveLength(0);
    expect(log.calls["error"]).toHaveLength(0);
  });

  it("includes method, path, and provider in the record", () => {
    const log = makeLogger();
    const ctx = makeCtx(makeApp(log), {
      method: "create",
      path: "orders",
      provider: "socket.io",
      error: new BadRequest("bad"),
    });
    logError({ includeStack: false })(ctx);
    expect(log.calls["warn"][0][1]).toMatchObject({
      method: "create",
      path: "orders",
      provider: "socket.io",
    });
  });

  it("redacts sensitive fields in error.data", () => {
    const log = makeLogger();
    const ctx = makeCtx(makeApp(log), { error: new BadRequest("bad", { password: "shh", ok: "kept" }) });
    logError({ includeStack: false })(ctx);
    expect(log.calls["warn"][0][1]!["data"]).toEqual({ password: "[Redacted]", ok: "kept" });
  });

  it("omits data from the record when the error has no data", () => {
    const log = makeLogger();
    const ctx = makeCtx(makeApp(log), { error: new BadRequest("bad") });
    logError({ includeStack: false })(ctx);
    expect(log.calls["warn"][0][1]).not.toHaveProperty("data");
  });
});
