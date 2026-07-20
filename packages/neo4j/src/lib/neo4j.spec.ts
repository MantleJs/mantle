import { describe, it, expect, vi } from "vitest";

vi.mock("neo4j-driver", () => {
  function MockDriver(this: Record<string, unknown>) {
    this._mocked = true;
  }
  return {
    default: {
      driver: () => new (MockDriver as unknown as new () => Record<string, unknown>)(),
      auth: { basic: (u: string, p: string) => ({ scheme: "basic", principal: u, credentials: p }) },
    },
  };
});

import { neo4j } from "./neo4j.js";

describe("neo4j plugin", () => {
  it("stores a Neo4j driver on the app under the 'neo4j' key", () => {
    const store: Record<string, unknown> = {};
    const app = {
      set: (key: string, value: unknown) => {
        store[key] = value;
      },
      get: (key: string) => store[key],
    };

    const plugin = neo4j({ auth: { username: "neo4j", password: "password" } });
    plugin(app as never);

    expect(store["neo4j"]).toBeDefined();
    expect((store["neo4j"] as Record<string, unknown>)["_mocked"]).toBe(true);
  });

  it("stores the database name on the app", () => {
    const store: Record<string, unknown> = {};
    const app = {
      set: (key: string, value: unknown) => {
        store[key] = value;
      },
      get: (key: string) => store[key],
    };

    const plugin = neo4j({ auth: { username: "neo4j", password: "password" }, database: "mydb" });
    plugin(app as never);

    expect(store["neo4j:database"]).toBe("mydb");
  });

  it("defaults the database to 'neo4j' when not specified", () => {
    const store: Record<string, unknown> = {};
    const app = {
      set: (key: string, value: unknown) => {
        store[key] = value;
      },
      get: (key: string) => store[key],
    };

    const plugin = neo4j({ auth: { username: "neo4j", password: "password" } });
    plugin(app as never);

    expect(store["neo4j:database"]).toBe("neo4j");
  });

  it("returns a plugin function", () => {
    const plugin = neo4j({ auth: { username: "neo4j", password: "pass" } });
    expect(typeof plugin).toBe("function");
  });
});
