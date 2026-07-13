import { describe, it, expect, vi } from "vitest";
import { mantle } from "@mantlejs/mantle";
import { sync } from "./sync.js";
import type { SyncAdapter, SyncMessage } from "./sync.js";

function makeAdapter(overrides: Partial<SyncAdapter> = {}): SyncAdapter {
  return {
    publish: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("sync", () => {
  it("returns a MantlePlugin function", () => {
    expect(typeof sync({ adapter: makeAdapter() })).toBe("function");
  });

  it("subscribes to the broker channel on configure", async () => {
    const adapter = makeAdapter();
    const app = mantle();
    await sync({ adapter })(app);
    expect(adapter.subscribe).toHaveBeenCalledWith("mantle:sync", expect.any(Function));
  });

  it("uses a custom channel name when provided", async () => {
    const adapter = makeAdapter();
    const app = mantle();
    await sync({ adapter, channel: "my-channel" })(app);
    expect(adapter.subscribe).toHaveBeenCalledWith("my-channel", expect.any(Function));
  });

  it("publishes service:event emissions to the broker", async () => {
    const adapter = makeAdapter();
    const app = mantle();
    await sync({ adapter })(app);

    app.emit("service:event", "users", "created", { id: 1 }, {});

    await vi.waitFor(() => expect(adapter.publish).toHaveBeenCalled());
    expect(adapter.publish).toHaveBeenCalledWith(
      "mantle:sync",
      expect.objectContaining({ path: "users", event: "created", result: { id: 1 } }),
    );
  });

  it("includes a stable originId in published messages", async () => {
    const messages: SyncMessage[] = [];
    const adapter = makeAdapter({
      publish: vi.fn().mockImplementation(async (_ch: string, msg: SyncMessage) => {
        messages.push(msg);
      }),
    });
    const app = mantle();
    await sync({ adapter })(app);

    app.emit("service:event", "users", "created", {}, {});
    app.emit("service:event", "posts", "updated", {}, {});

    await vi.waitFor(() => expect(messages.length).toBe(2));
    expect(messages[0].originId).toBe(messages[1].originId);
    expect(typeof messages[0].originId).toBe("string");
  });

  it("drops messages whose originId matches the local instance", async () => {
    let capturedHandler: ((msg: SyncMessage) => void) | null = null;
    let capturedOriginId: string | null = null;

    const adapter = makeAdapter({
      publish: vi.fn().mockImplementation(async (_ch: string, msg: SyncMessage) => {
        capturedOriginId = msg.originId;
      }),
      subscribe: vi.fn().mockImplementation(async (_ch: string, handler: (msg: SyncMessage) => void) => {
        capturedHandler = handler;
      }),
    });

    const app = mantle();
    await sync({ adapter })(app);

    // Trigger a publish so we capture the instanceId
    app.emit("service:event", "users", "created", {}, {});
    await vi.waitFor(() => expect(capturedOriginId).not.toBeNull());

    const emitSpy = vi.spyOn(app, "emit");

    // Simulate receiving back the same message (same originId)
    if (!capturedHandler || !capturedOriginId) throw new Error("handler or originId not captured");
    capturedHandler({ originId: capturedOriginId, path: "users", event: "created", result: {}, params: {} });

    expect(emitSpy).not.toHaveBeenCalled();
  });

  it("re-emits messages from other instances onto the local bus", async () => {
    let capturedHandler: ((msg: SyncMessage) => void) | null = null;
    const adapter = makeAdapter({
      subscribe: vi.fn().mockImplementation(async (_ch: string, handler: (msg: SyncMessage) => void) => {
        capturedHandler = handler;
      }),
    });

    const app = mantle();
    await sync({ adapter })(app);

    const emitSpy = vi.spyOn(app, "emit");

    if (!capturedHandler) throw new Error("handler not captured");
    capturedHandler({
      originId: "other-instance-id",
      path: "posts",
      event: "created",
      result: { id: 99 },
      params: {},
    });

    expect(emitSpy).toHaveBeenCalledWith("service:event", "posts", "created", { id: 99 }, {});
  });

  it("never publishes headers, connection, or the full user record", async () => {
    const messages: SyncMessage[] = [];
    const adapter = makeAdapter({
      publish: vi.fn().mockImplementation(async (_ch: string, msg: SyncMessage) => {
        messages.push(msg);
      }),
    });
    const app = mantle();
    await sync({ adapter })(app);

    app.emit("service:event", "users", "created", { id: 1 }, {
      provider: "rest",
      query: { active: true },
      headers: { authorization: "Bearer x" },
      connection: { socket: "not-serializable" },
      user: { id: 7, email: "alice@example.com", password: "hash" },
    });

    await vi.waitFor(() => expect(messages.length).toBe(1));
    expect(messages[0].params).toEqual({
      provider: "rest",
      query: { active: true },
      user: { id: 7 },
    });
    expect(messages[0].params).not.toHaveProperty("headers");
    expect(messages[0].params).not.toHaveProperty("connection");
  });

  it("re-emits received messages with the whitelisted params shape only", async () => {
    let capturedHandler: ((msg: SyncMessage) => void) | null = null;
    const adapter = makeAdapter({
      subscribe: vi.fn().mockImplementation(async (_ch: string, handler: (msg: SyncMessage) => void) => {
        capturedHandler = handler;
      }),
    });

    const app = mantle();
    await sync({ adapter })(app);

    const emitSpy = vi.spyOn(app, "emit");

    if (!capturedHandler) throw new Error("handler not captured");
    capturedHandler({
      originId: "other-instance-id",
      path: "posts",
      event: "created",
      result: { id: 99 },
      params: {
        provider: "rest",
        user: { id: 5 },
        headers: { authorization: "Bearer leaked" },
      } as unknown as SyncMessage["params"],
    });

    expect(emitSpy).toHaveBeenCalledWith("service:event", "posts", "created", { id: 99 }, {
      provider: "rest",
      user: { id: 5 },
    });
  });

  it("closes the adapter during teardown", async () => {
    const adapter = makeAdapter();
    const app = mantle();
    await sync({ adapter })(app);
    await app.teardown();
    expect(adapter.close).toHaveBeenCalled();
  });

  it("logs a warning and does not throw when subscribe fails", async () => {
    const warnSpy = vi.fn();
    const adapter = makeAdapter({
      subscribe: vi.fn().mockRejectedValue(new Error("connection refused")),
    });
    const app = mantle();
    app.set("logger", { debug: vi.fn(), info: vi.fn(), warn: warnSpy, error: vi.fn() });

    await expect(sync({ adapter })(app)).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith("sync: subscribe failed", expect.objectContaining({ component: "mantle:sync" }));
  });

  it("logs a warning and does not throw when publish fails", async () => {
    const warnSpy = vi.fn();
    const adapter = makeAdapter({
      publish: vi.fn().mockRejectedValue(new Error("network error")),
    });
    const app = mantle();
    app.set("logger", { debug: vi.fn(), info: vi.fn(), warn: warnSpy, error: vi.fn() });

    await sync({ adapter })(app);
    app.emit("service:event", "users", "created", {}, {});

    await vi.waitFor(() => expect(warnSpy).toHaveBeenCalled());
    expect(warnSpy).toHaveBeenCalledWith("sync: publish failed", expect.objectContaining({ component: "mantle:sync" }));
  });
});
