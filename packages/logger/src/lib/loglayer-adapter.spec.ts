import { withContext } from "@mantlejs/mantle";
import { loglayerAdapter } from "./loglayer-adapter.js";
import type { LogLayerLike } from "./loglayer-adapter.js";

function makeLogLayer(): LogLayerLike & { calls: { meta: Record<string, unknown>; level: string; msg: string }[] } {
  const calls: { meta: Record<string, unknown>; level: string; msg: string }[] = [];
  return {
    calls,
    withMetadata(meta: Record<string, unknown>) {
      return {
        debug: (msg: string) => calls.push({ meta, level: "debug", msg }),
        info: (msg: string) => calls.push({ meta, level: "info", msg }),
        warn: (msg: string) => calls.push({ meta, level: "warn", msg }),
        error: (msg: string) => calls.push({ meta, level: "error", msg }),
      };
    },
  };
}

describe("loglayerAdapter()", () => {
  it("calls withMetadata with the context and then the level method", () => {
    const log = makeLogLayer();
    const adapter = loglayerAdapter(log);
    adapter.info("hello", { component: "test" });
    expect(log.calls[0]).toEqual({ meta: { component: "test" }, level: "info", msg: "hello" });
  });

  it("delegates all four levels", () => {
    const log = makeLogLayer();
    const adapter = loglayerAdapter(log);
    adapter.debug("d");
    adapter.info("i");
    adapter.warn("w");
    adapter.error("e");
    expect(log.calls.map((c) => c.level)).toEqual(["debug", "info", "warn", "error"]);
  });

  it("merges correlationId from RequestContext", () => {
    const log = makeLogLayer();
    const adapter = loglayerAdapter(log);
    withContext({ correlationId: "req-abc" }, () => {
      adapter.info("hello", { component: "test" });
    });
    expect(log.calls[0]?.meta).toEqual({ correlationId: "req-abc", component: "test" });
  });

  it("folds child bindings into every withMetadata call", () => {
    const log = makeLogLayer();
    const adapter = loglayerAdapter(log);
    const child = adapter.child!({ service: "users" });
    child.info("hello");
    child.warn("careful");
    expect(log.calls[0]?.meta).toEqual({ service: "users" });
    expect(log.calls[1]?.meta).toEqual({ service: "users" });
  });

  it("per-call context overrides child bindings", () => {
    const log = makeLogLayer();
    const adapter = loglayerAdapter(log);
    const child = adapter.child!({ service: "users" });
    child.info("hello", { service: "override" });
    expect(log.calls[0]?.meta).toEqual({ service: "override" });
  });

  it("child bindings compose across nested child() calls", () => {
    const log = makeLogLayer();
    const adapter = loglayerAdapter(log);
    const child = adapter.child!({ a: "1" }).child!({ b: "2" });
    child.info("hello");
    expect(log.calls[0]?.meta).toEqual({ a: "1", b: "2" });
  });
});
