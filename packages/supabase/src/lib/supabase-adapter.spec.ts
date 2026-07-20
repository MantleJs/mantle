import { describe, it, expect, vi, beforeEach } from "vitest";
import { supabaseAdapter, type SyncMessage } from "./supabase-adapter.js";

// ─── Mock @supabase/supabase-js ───────────────────────────────────────────────

let capturedBroadcastHandler: ((payload: { payload: SyncMessage }) => void) | null = null;
const removedChannels: unknown[] = [];

const mockChannel = {
  on: vi.fn().mockReturnThis(),
  subscribe: vi.fn((cb: (status: string) => void) => {
    // Simulate async subscription success
    Promise.resolve().then(() => cb("SUBSCRIBED"));
    return mockChannel;
  }),
  send: vi.fn().mockResolvedValue(undefined),
};

const mockClient = {
  channel: vi.fn().mockReturnValue(mockChannel),
  removeChannel: vi.fn((ch: unknown) => {
    removedChannels.push(ch);
    return Promise.resolve();
  }),
};

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => mockClient),
}));

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("supabaseAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedBroadcastHandler = null;
    removedChannels.length = 0;
    mockChannel.on.mockImplementation(
      (event: string, filter: unknown, handler: (payload: { payload: SyncMessage }) => void) => {
        if (event === "broadcast") {
          capturedBroadcastHandler = handler;
        }
        return mockChannel;
      },
    );
    mockChannel.subscribe.mockImplementation((cb: (status: string) => void) => {
      Promise.resolve().then(() => cb("SUBSCRIBED"));
      return mockChannel;
    });
  });

  it("throws if url and key are not provided and env vars are missing", () => {
    const origUrl = process.env["SUPABASE_URL"];
    const origKey = process.env["SUPABASE_SERVICE_KEY"];
    delete process.env["SUPABASE_URL"];
    delete process.env["SUPABASE_SERVICE_KEY"];
    delete process.env["SUPABASE_KEY"];
    expect(() => supabaseAdapter()).toThrow(/url and key are required/);
    if (origUrl) process.env["SUPABASE_URL"] = origUrl;
    if (origKey) process.env["SUPABASE_SERVICE_KEY"] = origKey;
  });

  it("creates a Supabase client from provided options", async () => {
    const { createClient } = await import("@supabase/supabase-js");
    supabaseAdapter({ url: "https://test.supabase.co", key: "service-key" });
    expect(createClient).toHaveBeenCalledWith("https://test.supabase.co", "service-key");
  });

  describe("subscribe", () => {
    it("subscribes to the given channel and calls the handler on broadcast", async () => {
      const adapter = supabaseAdapter({ url: "https://test.supabase.co", key: "key" });
      const handler = vi.fn();
      await adapter.subscribe("mantle:sync", handler);

      expect(mockClient.channel).toHaveBeenCalledWith("mantle:sync");
      expect(mockChannel.on).toHaveBeenCalledWith("broadcast", { event: "sync" }, expect.any(Function));

      const msg: SyncMessage = { originId: "abc", path: "messages", event: "created", result: {}, params: {} };
      if (!capturedBroadcastHandler) throw new Error("handler not captured");
      capturedBroadcastHandler({ payload: msg });
      expect(handler).toHaveBeenCalledWith(msg);
    });

    it("rejects if channel subscription times out", async () => {
      mockChannel.subscribe.mockImplementation((cb: (status: string) => void) => {
        Promise.resolve().then(() => cb("TIMED_OUT"));
        return mockChannel;
      });
      const adapter = supabaseAdapter({ url: "https://test.supabase.co", key: "key" });
      await expect(adapter.subscribe("mantle:sync", vi.fn())).rejects.toThrow(/TIMED_OUT/);
    });
  });

  describe("publish", () => {
    it("sends a broadcast message to the subscribed channel", async () => {
      const adapter = supabaseAdapter({ url: "https://test.supabase.co", key: "key" });
      await adapter.subscribe("mantle:sync", vi.fn());

      const msg: SyncMessage = { originId: "abc", path: "messages", event: "created", result: { id: 1 }, params: {} };
      await adapter.publish("mantle:sync", msg);

      expect(mockChannel.send).toHaveBeenCalledWith({
        type: "broadcast",
        event: "sync",
        payload: msg,
      });
    });

    it("is a no-op if subscribe has not been called yet", async () => {
      const adapter = supabaseAdapter({ url: "https://test.supabase.co", key: "key" });
      const msg: SyncMessage = { originId: "abc", path: "messages", event: "created", result: {}, params: {} };
      await expect(adapter.publish("mantle:sync", msg)).resolves.toBeUndefined();
      expect(mockChannel.send).not.toHaveBeenCalled();
    });
  });

  describe("close", () => {
    it("removes the realtime channel on close", async () => {
      const adapter = supabaseAdapter({ url: "https://test.supabase.co", key: "key" });
      await adapter.subscribe("mantle:sync", vi.fn());
      await adapter.close();
      expect(mockClient.removeChannel).toHaveBeenCalledWith(mockChannel);
    });

    it("is idempotent — does nothing if not subscribed", async () => {
      const adapter = supabaseAdapter({ url: "https://test.supabase.co", key: "key" });
      await expect(adapter.close()).resolves.toBeUndefined();
      expect(mockClient.removeChannel).not.toHaveBeenCalled();
    });
  });

  describe("env var fallback", () => {
    it("reads url and key from environment variables", async () => {
      process.env["SUPABASE_URL"] = "https://env.supabase.co";
      process.env["SUPABASE_SERVICE_KEY"] = "env-key";
      const { createClient } = await import("@supabase/supabase-js");
      supabaseAdapter();
      expect(createClient).toHaveBeenCalledWith("https://env.supabase.co", "env-key");
      delete process.env["SUPABASE_URL"];
      delete process.env["SUPABASE_SERVICE_KEY"];
    });
  });
});
