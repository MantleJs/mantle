import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { BadRequest, NESTED_QUERY_CASES } from "@mantlejs/mantle";
import { MONGO_OPERATORS, toMongoFilter, toMongoProjection, toMongoSort } from "./mongo-filter.js";

describe("toMongoFilter", () => {
  it("passes equality clauses through unchanged", () => {
    expect(toMongoFilter({ title: "Hello", views: 5 })).toEqual({ title: "Hello", views: 5 });
  });

  it("passes null equality through (MongoDB null matches missing or null)", () => {
    expect(toMongoFilter({ deletedAt: null })).toEqual({ deletedAt: null });
  });

  it("passes comparison operators through unchanged", () => {
    expect(toMongoFilter({ views: { $gt: 5, $lte: 100 } })).toEqual({ views: { $gt: 5, $lte: 100 } });
  });

  it("passes $ne, $in and $nin through unchanged", () => {
    expect(toMongoFilter({ status: { $ne: null }, tag: { $in: ["a", "b"] }, kind: { $nin: ["x"] } })).toEqual({
      status: { $ne: null },
      tag: { $in: ["a", "b"] },
      kind: { $nin: ["x"] },
    });
  });

  it("recurses into $or and $and clauses", () => {
    expect(
      toMongoFilter({
        $or: [{ views: { $gt: 10 } }, { tags: { $contains: "hot" } }],
      }),
    ).toEqual({
      $or: [{ views: { $gt: 10 } }, { tags: "hot" }],
    });
  });

  it("maps id equality to _id with ObjectId conversion", () => {
    const hex = "665f1f77bcf86cd799439011";
    const filter = toMongoFilter({ id: hex });
    expect(filter["_id"]).toBeInstanceOf(ObjectId);
    expect((filter["_id"] as ObjectId).toHexString()).toBe(hex);
  });

  it("maps id operator objects to _id, converting array operands", () => {
    const a = "665f1f77bcf86cd799439011";
    const b = "665f1f77bcf86cd799439012";
    const filter = toMongoFilter({ id: { $in: [a, b] } });
    const inList = (filter["_id"] as { $in: ObjectId[] }).$in;
    expect(inList.map((v) => v.toHexString())).toEqual([a, b]);
  });

  it("leaves non-ObjectId id values untouched", () => {
    expect(toMongoFilter({ id: "not-an-object-id" })).toEqual({ _id: "not-an-object-id" });
  });

  it("keeps comparison operators alongside $contains on the same field", () => {
    expect(toMongoFilter({ tags: { $contains: "hot", $ne: null } })).toEqual({
      tags: { $ne: null },
      $and: [{ tags: "hot" }],
    });
  });

  it("rejects $like, $ilike and $notlike with BadRequest", () => {
    for (const op of ["$like", "$ilike", "$notlike"]) {
      expect(() => toMongoFilter({ title: { [op]: "%x%" } })).toThrow(BadRequest);
    }
  });

  it("rejects unknown operators with BadRequest naming the adapter", () => {
    expect(() => toMongoFilter({ title: { $regex: "x" } })).toThrow(/\$regex is not supported by @mantlejs\/mongodb/);
  });

  describe("shared nested-path + $contains conformance cases", () => {
    const expectedFilters: Record<string, Record<string, unknown>> = {
      "dot-path equality": { "metadata.owner.name": "alice" },
      "dot-path comparison operator": { "metadata.level": { $gt: 4 } },
      "$contains scalar element on a top-level array": { tags: "blue" },
      "$contains array operand (all elements required)": { tags: { $all: ["red", "blue"] } },
      "$contains on a dot-path array": { "metadata.tags": "a" },
      "$contains object operand (JSON superset)": { "metadata.owner.name": "alice" },
    };

    for (const testCase of NESTED_QUERY_CASES) {
      it(`translates: ${testCase.name}`, () => {
        expect(expectedFilters[testCase.name]).toBeDefined();
        expect(toMongoFilter(testCase.where)).toEqual(expectedFilters[testCase.name]);
      });
    }
  });
});

describe("toMongoSort", () => {
  it("maps asc/desc to 1/-1 and id to _id", () => {
    expect(toMongoSort({ id: "asc", views: "desc" })).toEqual({ _id: 1, views: -1 });
  });
});

describe("toMongoProjection", () => {
  it("builds an inclusion projection, dropping the implicit id", () => {
    expect(toMongoProjection(["id", "title", "views"])).toEqual({ title: 1, views: 1 });
  });
});

describe("MONGO_OPERATORS", () => {
  it("lists exactly the supported operator set", () => {
    expect([...MONGO_OPERATORS].sort()).toEqual(
      ["$and", "$contains", "$gt", "$gte", "$in", "$lt", "$lte", "$ne", "$nin", "$or"].sort(),
    );
  });
});
