import { describe, it, expect } from "vitest";
import { Type } from "@sinclair/typebox";
import { mantle } from "@mantlejs/mantle";
import { Unprocessable } from "@mantlejs/mantle";
import type { HookContext, MantleApplication, Service } from "@mantlejs/mantle";
import { validate } from "./validate.js";
import { querySyntax } from "./query-syntax.js";

const UserSchema = Type.Object({
  id: Type.Optional(Type.String()),
  name: Type.String(),
  age: Type.Number(),
  active: Type.Boolean(),
});

const UserQuery = querySyntax(UserSchema);

function makeQueryCtx(query: Record<string, unknown>): HookContext {
  return {
    app: mantle() as MantleApplication,
    service: {} as Partial<Service<unknown>>,
    path: "users",
    method: "find",
    params: { query },
  };
}

function run(query: Record<string, unknown>, schema = UserQuery): HookContext {
  const hook = validate(schema, { target: "query", coerce: true });
  return hook(makeQueryCtx(query)) as HookContext;
}

describe("querySyntax()", () => {
  it("accepts bare equality values", () => {
    expect(() => run({ name: "Alice", active: true })).not.toThrow();
  });

  it("accepts operator objects typed to the field", () => {
    expect(() => run({ age: { $gt: 21, $lte: 65 }, name: { $in: ["a", "b"] } })).not.toThrow();
  });

  it("coerces query-string values through operator objects", () => {
    const ctx = run({ age: { $gt: "21" }, active: "true", $limit: "10" });
    const query = ctx.params.query as Record<string, unknown>;
    expect((query["age"] as { $gt: number }).$gt).toBe(21);
    expect(query["active"]).toBe(true);
    expect(query["$limit"]).toBe(10);
  });

  it("rejects an unknown operator on a field", () => {
    expect(() => run({ age: { $regex: ".*" } })).toThrow(Unprocessable);
  });

  it("rejects a field that is not on the entity schema", () => {
    expect(() => run({ secret: "x" })).toThrow(Unprocessable);
  });

  it("allows $like/$notlike/$ilike only on string fields", () => {
    expect(() => run({ name: { $like: "%ali%" } })).not.toThrow();
    expect(() => run({ age: { $like: "%2%" } })).toThrow(Unprocessable);
  });

  describe("reserved keys", () => {
    it("validates $limit and $skip as non-negative integers", () => {
      expect(() => run({ $limit: 10, $skip: 0 })).not.toThrow();
      expect(() => run({ $limit: -1 })).toThrow(Unprocessable);
      expect(() => run({ $skip: "abc" })).toThrow(Unprocessable);
    });

    it("caps $limit at options.maxLimit", () => {
      const capped = querySyntax(UserSchema, { maxLimit: 100 });
      expect(() => run({ $limit: 100 }, capped)).not.toThrow();
      expect(() => run({ $limit: 101 }, capped)).toThrow(Unprocessable);
    });

    it("validates $sort directions per field", () => {
      expect(() => run({ $sort: { name: "asc", age: -1 } })).not.toThrow();
      expect(() => run({ $sort: { name: "up" } })).toThrow(Unprocessable);
      expect(() => run({ $sort: { secret: "asc" } })).toThrow(Unprocessable);
    });

    it("validates $select against entity field names", () => {
      expect(() => run({ $select: ["name", "age"] })).not.toThrow();
      expect(() => run({ $select: "name" })).not.toThrow();
      expect(() => run({ $select: ["secret"] })).toThrow(Unprocessable);
    });

    it("validates $or / $and as arrays of where clauses", () => {
      expect(() => run({ $or: [{ name: "a" }, { age: { $gt: 21 } }] })).not.toThrow();
      expect(() => run({ $and: [{ active: true }] })).not.toThrow();
      expect(() => run({ $or: [{ secret: "x" }] })).toThrow(Unprocessable);
    });
  });
});
