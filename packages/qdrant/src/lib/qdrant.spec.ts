import { describe, it, expect, vi } from "vitest";

// Mock the Qdrant client before importing the plugin
vi.mock("@qdrant/js-client-rest", () => {
  function QdrantClient(this: Record<string, unknown>) {
    this._mocked = true;
  }
  return { QdrantClient };
});

import { qdrant } from "./qdrant.js";

describe("qdrant plugin", () => {
  it("stores a QdrantClient on the app under the 'qdrant' key", () => {
    const store: Record<string, unknown> = {};
    const app = {
      set: (key: string, value: unknown) => {
        store[key] = value;
      },
      get: (key: string) => store[key],
    };

    const plugin = qdrant({ url: "http://localhost:6333" });
    plugin(app as never);

    expect(store["qdrant"]).toBeDefined();
    expect((store["qdrant"] as Record<string, unknown>)["_mocked"]).toBe(true);
  });

  it("returns a plugin function", () => {
    const plugin = qdrant();
    expect(typeof plugin).toBe("function");
  });
});
