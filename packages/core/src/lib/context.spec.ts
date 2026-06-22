import { withContext, getContext } from "./context.js";

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
    withContext({ correlationId: "abc-123" }, () => {});
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
