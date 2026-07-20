import { describe, it, expect, vi, beforeEach } from "vitest";
import { redisAdapter } from "./redis-adapter.js";
import type { SyncMessage } from "./sync.js";

const { mockOn, mockSubscribeRedis, mockPublish, mockQuit } = vi.hoisted(() => {
  return {
    mockOn: vi.fn(),
    mockSubscribeRedis: vi.fn().mockResolvedValue(undefined),
    mockPublish: vi.fn().mockResolvedValue(1),
    mockQuit: vi.fn().mockResolvedValue("OK"),
  };
});

vi.mock("ioredis", () => {
  class MockRedis {
    on = mockOn;
    subscribe = mockSubscribeRedis;
    publish = mockPublish;
    quit = mockQuit;
  }
  return { Redis: MockRedis };
});

describe("redisAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSubscribeRedis.mockResolvedValue(undefined);
    mockPublish.mockResolvedValue(1);
    mockQuit.mockResolvedValue("OK");
  });

  it("subscribes to the given channel on the sub connection", async () => {
    const adapter = redisAdapter();
    await adapter.subscribe("mantle:sync", vi.fn());
    expect(mockSubscribeRedis).toHaveBeenCalledWith("mantle:sync");
  });

  it("registers a message listener on the subscriber connection", async () => {
    const adapter = redisAdapter();
    await adapter.subscribe("mantle:sync", vi.fn());
    expect(mockOn).toHaveBeenCalledWith("message", expect.any(Function));
  });

  it("calls the handler with parsed SyncMessage on incoming messages", async () => {
    const handler = vi.fn();
    const adapter = redisAdapter();
    await adapter.subscribe("mantle:sync", handler);

    const messageListener = mockOn.mock.calls.find((call: unknown[]) => call[0] === "message")?.[1] as
      | ((ch: string, payload: string) => void)
      | undefined;

    const message: SyncMessage = { originId: "abc", path: "users", event: "created", result: {}, params: {} };
    messageListener?.("mantle:sync", JSON.stringify(message));

    expect(handler).toHaveBeenCalledWith(message);
  });

  it("ignores malformed JSON payloads", async () => {
    const handler = vi.fn();
    const adapter = redisAdapter();
    await adapter.subscribe("mantle:sync", handler);

    const messageListener = mockOn.mock.calls.find((call: unknown[]) => call[0] === "message")?.[1] as
      | ((ch: string, payload: string) => void)
      | undefined;

    expect(() => messageListener?.("mantle:sync", "not-json")).not.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });

  it("publishes serialised messages via the pub connection", async () => {
    const adapter = redisAdapter();
    await adapter.subscribe("mantle:sync", vi.fn());

    const message: SyncMessage = { originId: "xyz", path: "posts", event: "patched", result: {}, params: {} };
    await adapter.publish("mantle:sync", message);

    expect(mockPublish).toHaveBeenCalledWith("mantle:sync", JSON.stringify(message));
  });

  it("does nothing on publish when not yet subscribed", async () => {
    const adapter = redisAdapter();
    await adapter.publish("mantle:sync", { originId: "x", path: "p", event: "e", result: null, params: {} });
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it("quits both connections on close", async () => {
    const adapter = redisAdapter();
    await adapter.subscribe("mantle:sync", vi.fn());
    await adapter.close();
    expect(mockQuit).toHaveBeenCalledTimes(2);
  });
});
