import { describe, expect, it } from "vitest";
import { BadRequest } from "./errors.js";
import { assertOperators } from "./query-operators.js";

const SUPPORTED = new Set(["$lt", "$lte", "$gt", "$gte", "$ne", "$in", "$nin", "$or", "$and"]);

describe("assertOperators", () => {
  it("accepts a where clause using only supported operators", () => {
    expect(() =>
      assertOperators(
        { age: { $gt: 21 }, status: { $in: ["a", "b"] }, name: "Alice", deletedAt: null },
        SUPPORTED,
        "test-adapter",
      ),
    ).not.toThrow();
  });

  it("throws BadRequest for an unknown operator", () => {
    expect(() => assertOperators({ age: { $get: 21 } }, SUPPORTED, "test-adapter")).toThrow(BadRequest);
  });

  it("names the operator, the adapter, and the supported set in the message", () => {
    expect(() => assertOperators({ age: { $get: 21 } }, SUPPORTED, "test-adapter")).toThrow(
      /Operator \$get is not supported by test-adapter\. Supported: .*\$lt.*\$or/,
    );
  });

  it("carries an actionable hint on the operator error", () => {
    try {
      assertOperators({ age: { $get: 21 } }, SUPPORTED, "test-adapter");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as BadRequest).hint).toMatch(/test-adapter/);
      expect((err as BadRequest).toJSON()["hint"]).toBeDefined();
    }
  });

  it("throws for an unsupported top-level logical operator", () => {
    expect(() => assertOperators({ $nor: [{ a: 1 }] }, SUPPORTED, "test-adapter")).toThrow(BadRequest);
  });

  it("recurses into $or arrays", () => {
    expect(() =>
      assertOperators({ $or: [{ age: { $gt: 1 } }, { age: { $bogus: 2 } }] }, SUPPORTED, "test-adapter"),
    ).toThrow(/\$bogus/);
  });

  it("recurses into $and arrays", () => {
    expect(() =>
      assertOperators({ $and: [{ $or: [{ x: { $like: "a" } }] }] }, SUPPORTED, "test-adapter"),
    ).toThrow(/\$like/);
  });

  it("ignores non-operator keys inside operator objects", () => {
    expect(() => assertOperators({ meta: { nested: "value" } }, SUPPORTED, "test-adapter")).not.toThrow();
  });

  it("accepts an empty where clause", () => {
    expect(() => assertOperators({}, SUPPORTED, "test-adapter")).not.toThrow();
  });
});
