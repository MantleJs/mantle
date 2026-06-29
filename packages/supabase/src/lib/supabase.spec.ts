import { describe, it, expect, vi, beforeEach } from "vitest";
import { supabase } from "./supabase.js";

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ supabaseMockClient: true })),
}));

describe("supabase plugin", () => {
  it("creates a Supabase client and stores it on the app", async () => {
    const { createClient } = await import("@supabase/supabase-js");

    const store: Record<string, unknown> = {};
    const app = {
      set: (key: string, value: unknown) => {
        store[key] = value;
      },
      get: (key: string) => store[key],
    };

    const plugin = supabase({ url: "https://test.supabase.co", key: "anon-key" });
    plugin(app as never);

    expect(createClient).toHaveBeenCalledWith("https://test.supabase.co", "anon-key", undefined);
    expect(store["supabase"]).toEqual({ supabaseMockClient: true });
  });

  it("passes options through to createClient", async () => {
    const { createClient } = await import("@supabase/supabase-js");

    const store: Record<string, unknown> = {};
    const app = {
      set: (key: string, value: unknown) => {
        store[key] = value;
      },
      get: (key: string) => store[key],
    };

    const options = { auth: { autoRefreshToken: false } };
    const plugin = supabase({ url: "https://test.supabase.co", key: "service-key", options });
    plugin(app as never);

    expect(createClient).toHaveBeenCalledWith("https://test.supabase.co", "service-key", options);
  });
});

describe("supabase plugin — config validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is a function that returns a MantlePlugin", () => {
    const plugin = supabase({ url: "https://x.supabase.co", key: "key" });
    expect(typeof plugin).toBe("function");
  });
});
