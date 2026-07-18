import { describe, expect, it, vi } from "vitest";
import type { MantleApplication } from "@mantlejs/mantle";

vi.mock("mongodb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("mongodb")>();
  return { ...actual, MongoClient: vi.fn() };
});

const { MongoClient } = await import("mongodb");
const { mongodb } = await import("./mongodb.js");

function makeClient() {
  return {
    db: vi.fn().mockReturnValue({ databaseName: "app" }),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function makeApp() {
  const store = new Map<string, unknown>();
  const app = {
    set: vi.fn((key: string, value: unknown) => {
      store.set(key, value);
      return app;
    }),
    get: vi.fn((key: string) => store.get(key)),
    teardown: vi.fn().mockResolvedValue(undefined),
  };
  return app as unknown as MantleApplication & { teardown: ReturnType<typeof vi.fn> };
}

describe("mongodb plugin", () => {
  it("opens one client and stores it with the target db on the app", () => {
    const client = makeClient();
    vi.mocked(MongoClient).mockImplementation(function () {
      return client as never;
    });
    const app = makeApp();

    mongodb({ uri: "mongodb://localhost:27017", dbName: "app" })(app);

    expect(MongoClient).toHaveBeenCalledWith("mongodb://localhost:27017", undefined);
    expect(client.db).toHaveBeenCalledWith("app");
    expect(app.get("mongoClient")).toBe(client);
    expect(app.get("mongoDb")).toEqual({ databaseName: "app" });
  });

  it("passes clientOptions through to the driver", () => {
    const client = makeClient();
    vi.mocked(MongoClient).mockImplementation(function () {
      return client as never;
    });
    const app = makeApp();

    mongodb({ uri: "mongodb://localhost:27017", dbName: "app", clientOptions: { maxPoolSize: 5 } })(app);

    expect(MongoClient).toHaveBeenCalledWith("mongodb://localhost:27017", { maxPoolSize: 5 });
  });

  it("closes the client on app.teardown() after the original teardown ran", async () => {
    const client = makeClient();
    vi.mocked(MongoClient).mockImplementation(function () {
      return client as never;
    });
    const app = makeApp();
    const originalTeardown = app.teardown;

    mongodb({ uri: "mongodb://localhost:27017", dbName: "app" })(app);
    await (app as unknown as { teardown(): Promise<void> }).teardown();

    expect(originalTeardown).toHaveBeenCalled();
    expect(client.close).toHaveBeenCalled();
  });
});
