import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MantleApplication } from "@mantlejs/mantle";

const { mockKnexFn, mockKnexInstance } = vi.hoisted(() => {
  const instance = { destroy: vi.fn().mockResolvedValue(undefined) };
  const fn = vi.fn(() => instance);
  return { mockKnexFn: fn, mockKnexInstance: instance };
});

vi.mock("knex", () => ({
  default: mockKnexFn,
}));

const { knex } = await import("./knex.js");

describe("knex plugin", () => {
  let app: MantleApplication;
  let setValues: Record<string, unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    setValues = {};
    app = {
      set: vi.fn((key: string, value: unknown) => {
        setValues[key] = value;
        return app;
      }),
      get: vi.fn((key: string) => setValues[key]),
      teardown: vi.fn().mockResolvedValue(undefined),
    } as unknown as MantleApplication;
  });

  it("returns a MantlePlugin function", () => {
    const plugin = knex({ client: "pg", connection: "postgresql://localhost/test" });
    expect(typeof plugin).toBe("function");
  });

  it("creates a knex instance with the given client and sets it on the app", () => {
    knex({ client: "pg", connection: "postgresql://localhost/test" })(app);
    expect(mockKnexFn).toHaveBeenCalledWith(
      expect.objectContaining({ client: "pg", connection: "postgresql://localhost/test" }),
    );
    expect(app.set).toHaveBeenCalledWith("knex", mockKnexInstance);
  });

  it("applies default pool settings (min 2, max 10)", () => {
    knex({ client: "pg", connection: "postgresql://localhost/test" })(app);
    const [config] = mockKnexFn.mock.calls[0] as unknown as [{ pool: { min: number; max: number } }];
    expect(config.pool).toEqual({ min: 2, max: 10 });
  });

  it("merges custom pool settings with defaults", () => {
    knex({ client: "pg", connection: "postgresql://localhost/test", pool: { max: 20 } })(app);
    const [config] = mockKnexFn.mock.calls[0] as unknown as [{ pool: { min: number; max: number } }];
    expect(config.pool).toEqual({ min: 2, max: 20 });
  });

  it("supports any client type (mysql2, sqlite3, etc.)", () => {
    knex({ client: "mysql2", connection: { host: "localhost", database: "test" } })(app);
    const [config] = mockKnexFn.mock.calls[0] as unknown as [{ client: string }];
    expect(config.client).toBe("mysql2");
  });

  it("passes searchPath when provided", () => {
    knex({ client: "pg", connection: "postgresql://localhost/test", searchPath: ["public", "app"] })(app);
    const [config] = mockKnexFn.mock.calls[0] as unknown as [{ searchPath?: string[] }];
    expect(config.searchPath).toEqual(["public", "app"]);
  });

  it("wraps teardown to destroy the knex connection pool", async () => {
    knex({ client: "pg", connection: "postgresql://localhost/test" })(app);
    await app.teardown();
    expect(mockKnexInstance.destroy).toHaveBeenCalled();
  });
});
