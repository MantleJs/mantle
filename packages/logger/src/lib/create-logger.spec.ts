// ---------------------------------------------------------------------------
// A fake `pino` module: records the options object it was called with, and
// returns a minimal PinoLike so pinoAdapter() has something to wrap.
// ---------------------------------------------------------------------------

function makeFakePinoModule() {
  const calls: Record<string, unknown>[] = [];
  const factory = vi.fn((opts: Record<string, unknown>) => {
    calls.push(opts);
    const instance = {
      calls: [] as { obj: object; msg: string }[],
      debug: vi.fn((obj: object, msg: string) => instance.calls.push({ obj, msg })),
      info: vi.fn((obj: object, msg: string) => instance.calls.push({ obj, msg })),
      warn: vi.fn((obj: object, msg: string) => instance.calls.push({ obj, msg })),
      error: vi.fn((obj: object, msg: string) => instance.calls.push({ obj, msg })),
      child: vi.fn(() => instance),
    };
    return instance;
  });
  return { calls, factory };
}

describe("createLogger()", () => {
  const originalNodeEnv = process.env["NODE_ENV"];

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env["NODE_ENV"];
    else process.env["NODE_ENV"] = originalNodeEnv;
    vi.doUnmock("pino");
    vi.doUnmock("pino-pretty");
  });

  it("defaults to debug level outside production", async () => {
    delete process.env["NODE_ENV"];
    const { calls, factory } = makeFakePinoModule();
    vi.doMock("pino", () => ({ default: factory }));

    const { createLogger } = await import("./create-logger.js");
    await createLogger();
    expect(calls[0]?.["level"]).toBe("debug");
  });

  it("defaults to info level in production", async () => {
    process.env["NODE_ENV"] = "production";
    const { calls, factory } = makeFakePinoModule();
    vi.doMock("pino", () => ({ default: factory }));

    const { createLogger } = await import("./create-logger.js");
    await createLogger();
    expect(calls[0]?.["level"]).toBe("info");
  });

  it("an explicit level option overrides the NODE_ENV default", async () => {
    const { calls, factory } = makeFakePinoModule();
    vi.doMock("pino", () => ({ default: factory }));

    const { createLogger } = await import("./create-logger.js");
    await createLogger({ level: "warn" });
    expect(calls[0]?.["level"]).toBe("warn");
  });

  it("defaults redact.paths to SENSITIVE_PATHS", async () => {
    const { calls, factory } = makeFakePinoModule();
    vi.doMock("pino", () => ({ default: factory }));

    const { createLogger } = await import("./create-logger.js");
    const { SENSITIVE_PATHS } = await import("./redact.js");
    await createLogger();
    expect(calls[0]?.["redact"]).toEqual({ paths: SENSITIVE_PATHS, censor: "[Redacted]" });
  });

  it("passes custom redact paths through", async () => {
    const { calls, factory } = makeFakePinoModule();
    vi.doMock("pino", () => ({ default: factory }));

    const { createLogger } = await import("./create-logger.js");
    await createLogger({ redact: ["custom"] });
    expect(calls[0]?.["redact"]).toEqual({ paths: ["custom"], censor: "[Redacted]" });
  });

  it("omits the redact option when redact: [] is passed", async () => {
    const { calls, factory } = makeFakePinoModule();
    vi.doMock("pino", () => ({ default: factory }));

    const { createLogger } = await import("./create-logger.js");
    await createLogger({ redact: [] });
    expect(calls[0]).not.toHaveProperty("redact");
  });

  it("gcp: true sets messageKey and a level -> severity formatter", async () => {
    const { calls, factory } = makeFakePinoModule();
    vi.doMock("pino", () => ({ default: factory }));

    const { createLogger } = await import("./create-logger.js");
    await createLogger({ gcp: true });
    expect(calls[0]?.["messageKey"]).toBe("message");
    const formatters = calls[0]?.["formatters"] as { level: (label: string) => Record<string, string> };
    expect(formatters.level("debug")).toEqual({ severity: "DEBUG" });
    expect(formatters.level("info")).toEqual({ severity: "INFO" });
    expect(formatters.level("warn")).toEqual({ severity: "WARNING" });
    expect(formatters.level("error")).toEqual({ severity: "ERROR" });
  });

  it("omits gcp fields by default", async () => {
    const { calls, factory } = makeFakePinoModule();
    vi.doMock("pino", () => ({ default: factory }));

    const { createLogger } = await import("./create-logger.js");
    await createLogger();
    expect(calls[0]).not.toHaveProperty("messageKey");
    expect(calls[0]).not.toHaveProperty("formatters");
  });

  it("pretty: true sets a pino-pretty transport when pino-pretty is resolvable", async () => {
    const { calls, factory } = makeFakePinoModule();
    vi.doMock("pino", () => ({ default: factory }));
    vi.doMock("pino-pretty", () => ({ default: () => undefined }));

    const { createLogger } = await import("./create-logger.js");
    await createLogger({ pretty: true });
    expect(calls[0]?.["transport"]).toEqual({ target: "pino-pretty" });
  });

  it("pretty: true is ignored in production", async () => {
    process.env["NODE_ENV"] = "production";
    const { calls, factory } = makeFakePinoModule();
    vi.doMock("pino", () => ({ default: factory }));

    const { createLogger } = await import("./create-logger.js");
    await createLogger({ pretty: true });
    expect(calls[0]).not.toHaveProperty("transport");
  });

  it("falls back to plain output and warns once when pino-pretty is not resolvable", async () => {
    const { calls, factory } = makeFakePinoModule();
    vi.doMock("pino", () => ({ default: factory }));
    vi.doMock("pino-pretty", () => {
      throw new Error("Cannot find module 'pino-pretty'");
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const { createLogger } = await import("./create-logger.js");
    await createLogger({ pretty: true });
    await createLogger({ pretty: true });

    expect(calls[0]).not.toHaveProperty("transport");
    expect(calls[1]).not.toHaveProperty("transport");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/pino-pretty/);
    warnSpy.mockRestore();
  });

  it("merges the pino escape-hatch option last, overriding computed defaults", async () => {
    const { calls, factory } = makeFakePinoModule();
    vi.doMock("pino", () => ({ default: factory }));

    const { createLogger } = await import("./create-logger.js");
    await createLogger({ level: "debug", pino: { level: "silent", customField: true } });
    expect(calls[0]?.["level"]).toBe("silent");
    expect(calls[0]?.["customField"]).toBe(true);
  });

  it("returns a Logger wrapping the pino instance, with child() available", async () => {
    const { factory } = makeFakePinoModule();
    vi.doMock("pino", () => ({ default: factory }));

    const { createLogger } = await import("./create-logger.js");
    const log = await createLogger();
    expect(typeof log.debug).toBe("function");
    expect(typeof log.child).toBe("function");
    log.debug("hello");
    log.child!({ service: "users" }).info("hi");
  });

  it("throws a GeneralError with an install hint when pino cannot be resolved", async () => {
    vi.doMock("pino", () => {
      throw new Error("Cannot find module 'pino'");
    });

    const { createLogger } = await import("./create-logger.js");
    let caught: { name: string; code: number; className: string; message: string; hint?: string } | undefined;
    try {
      await createLogger();
    } catch (err) {
      caught = err as typeof caught;
    }
    expect(caught?.name).toBe("GeneralError");
    expect(caught?.code).toBe(500);
    expect(caught?.className).toBe("general-error");
    expect(caught?.message).toMatch(/pino/i);
    expect(caught?.hint).toMatch(/npm install pino/);
  });

  it("works end-to-end against the real installed pino package", async () => {
    const { createLogger } = await import("./create-logger.js");
    const log = await createLogger({ level: "debug" });
    expect(() => log.debug("hello", { foo: "bar" })).not.toThrow();
    expect(() => log.child!({ service: "users" }).info("hi")).not.toThrow();
  });
});
