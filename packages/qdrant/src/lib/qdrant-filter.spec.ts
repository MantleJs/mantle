import { describe, expect, it } from "vitest";
import { BadRequest } from "@mantlejs/mantle";
import { toQdrantFilter } from "./qdrant-filter.js";

describe("toQdrantFilter", () => {
  describe("equality", () => {
    it("maps a simple value to a match condition", () => {
      expect(toQdrantFilter({ category: "tech" })).toEqual({
        must: [{ key: "category", match: { value: "tech" } }],
      });
    });

    it("maps a numeric value", () => {
      expect(toQdrantFilter({ score: 42 })).toEqual({
        must: [{ key: "score", match: { value: 42 } }],
      });
    });

    it("maps a boolean value", () => {
      expect(toQdrantFilter({ active: true })).toEqual({
        must: [{ key: "active", match: { value: true } }],
      });
    });
  });

  describe("null handling", () => {
    it("maps null to is_null condition", () => {
      expect(toQdrantFilter({ deletedAt: null })).toEqual({
        must: [{ is_null: { key: "deletedAt" } }],
      });
    });

    it("maps $ne: null to must_not is_null condition", () => {
      expect(toQdrantFilter({ deletedAt: { $ne: null } })).toEqual({
        must_not: [{ is_null: { key: "deletedAt" } }],
      });
    });
  });

  describe("array shorthand ($in)", () => {
    it("maps an array value to match.any condition", () => {
      expect(toQdrantFilter({ status: ["active", "pending"] })).toEqual({
        must: [{ key: "status", match: { any: ["active", "pending"] } }],
      });
    });
  });

  describe("comparison operators", () => {
    it("maps $gt to range.gt", () => {
      expect(toQdrantFilter({ score: { $gt: 0.5 } })).toEqual({
        must: [{ key: "score", range: { gt: 0.5 } }],
      });
    });

    it("maps $gte to range.gte", () => {
      expect(toQdrantFilter({ score: { $gte: 0.5 } })).toEqual({
        must: [{ key: "score", range: { gte: 0.5 } }],
      });
    });

    it("maps $lt to range.lt", () => {
      expect(toQdrantFilter({ score: { $lt: 1.0 } })).toEqual({
        must: [{ key: "score", range: { lt: 1.0 } }],
      });
    });

    it("maps $lte to range.lte", () => {
      expect(toQdrantFilter({ score: { $lte: 1.0 } })).toEqual({
        must: [{ key: "score", range: { lte: 1.0 } }],
      });
    });

    it("maps combined range operators", () => {
      expect(toQdrantFilter({ score: { $gte: 0.2, $lt: 0.9 } })).toEqual({
        must: [{ key: "score", range: { gte: 0.2, lt: 0.9 } }],
      });
    });
  });

  describe("$ne operator", () => {
    it("maps $ne value to must_not match condition", () => {
      expect(toQdrantFilter({ status: { $ne: "deleted" } })).toEqual({
        must_not: [{ key: "status", match: { value: "deleted" } }],
      });
    });
  });

  describe("$in and $nin operators", () => {
    it("maps $in to must match.any condition", () => {
      expect(toQdrantFilter({ tag: { $in: ["a", "b"] } })).toEqual({
        must: [{ key: "tag", match: { any: ["a", "b"] } }],
      });
    });

    it("maps $nin to must_not match.any condition", () => {
      expect(toQdrantFilter({ tag: { $nin: ["x", "y"] } })).toEqual({
        must_not: [{ key: "tag", match: { any: ["x", "y"] } }],
      });
    });
  });

  describe("unsupported operators", () => {
    it("rejects $like (no pattern matching remap in Qdrant)", () => {
      expect(() => toQdrantFilter({ title: { $like: "%hello%" } })).toThrow(BadRequest);
      expect(() => toQdrantFilter({ title: { $like: "%hello%" } })).toThrow(/\$like.*@mantlejs\/qdrant/);
    });

    it("rejects $ilike and $notlike", () => {
      expect(() => toQdrantFilter({ title: { $ilike: "%world%" } })).toThrow(BadRequest);
      expect(() => toQdrantFilter({ title: { $notlike: "%spam%" } })).toThrow(BadRequest);
    });

    it("rejects unknown operators, naming the operator and adapter", () => {
      expect(() => toQdrantFilter({ age: { $get: 21 } })).toThrow(
        /Operator \$get is not supported by @mantlejs\/qdrant\. Supported: /,
      );
    });

    it("rejects unknown operators nested in $or", () => {
      expect(() => toQdrantFilter({ $or: [{ age: { $get: 21 } }] })).toThrow(BadRequest);
    });
  });

  describe("$or and $and logical operators", () => {
    it("maps $or to should array of sub-filters", () => {
      expect(toQdrantFilter({ $or: [{ category: "tech" }, { category: "science" }] })).toEqual({
        should: [
          { must: [{ key: "category", match: { value: "tech" } }] },
          { must: [{ key: "category", match: { value: "science" } }] },
        ],
      });
    });

    it("maps $and to must array of sub-filters", () => {
      expect(toQdrantFilter({ $and: [{ status: "active" }, { score: { $gte: 0.5 } }] })).toEqual({
        must: [
          { must: [{ key: "status", match: { value: "active" } }] },
          { must: [{ key: "score", range: { gte: 0.5 } }] },
        ],
      });
    });
  });

  describe("multiple fields", () => {
    it("combines multiple fields as separate must conditions", () => {
      const result = toQdrantFilter({ category: "tech", active: true });
      expect(result.must).toHaveLength(2);
      expect(result.must).toEqual(
        expect.arrayContaining([
          { key: "category", match: { value: "tech" } },
          { key: "active", match: { value: true } },
        ]),
      );
    });
  });

  describe("empty filter", () => {
    it("returns an empty object for an empty where clause", () => {
      expect(toQdrantFilter({})).toEqual({});
    });
  });
});
