import { createRequestContext, withContext, getContext } from "./context.js";

describe("withContext / getContext", () => {
  it("returns undefined outside a withContext scope", () => {
    expect(getContext()).toBeUndefined();
  });

  it("returns the context inside withContext", () => {
    withContext({ correlationId: "abc-123" }, () => {
      expect(getContext()).toEqual({ correlationId: "abc-123" });
    });
  });

  it("does not leak context after the scope exits", () => {
    withContext({ correlationId: "abc-123" }, () => undefined);
    expect(getContext()).toBeUndefined();
  });

  it("propagates context through async operations", async () => {
    let captured: ReturnType<typeof getContext>;
    await new Promise<void>((resolve) => {
      withContext({ correlationId: "async-456" }, () => {
        Promise.resolve().then(() => {
          captured = getContext();
          resolve();
        });
      });
    });
    expect(captured).toEqual({ correlationId: "async-456" });
  });

  it("supports arbitrary extra fields on the context", () => {
    withContext({ correlationId: "xyz", userId: "u-1", traceId: "t-9" }, () => {
      expect(getContext()).toMatchObject({ correlationId: "xyz", userId: "u-1", traceId: "t-9" });
    });
  });

  it("isolates nested contexts", () => {
    withContext({ correlationId: "outer" }, () => {
      withContext({ correlationId: "inner" }, () => {
        expect(getContext()?.correlationId).toBe("inner");
      });
      expect(getContext()?.correlationId).toBe("outer");
    });
  });
});

describe("createRequestContext", () => {
  it("sets requestId", () => {
    expect(createRequestContext("req-1").requestId).toBe("req-1");
  });

  it("exposes correlationId as a deprecated alias that loggers spreading the context don't see", () => {
    const context = createRequestContext("req-1");
    expect(context.correlationId).toBe("req-1");
    expect({ ...context }).toEqual({ requestId: "req-1" });
  });

  it("carries the request's trace headers", () => {
    const traceparent = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
    expect({ ...createRequestContext("req-1", { traceparent, tracestate: "rojo=1" }) }).toEqual({
      requestId: "req-1",
      traceparent,
      tracestate: "rojo=1",
    });
  });
});
