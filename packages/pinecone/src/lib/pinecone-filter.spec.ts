import { describe, expect, it } from "vitest";
import { toPineconeFilter } from "./pinecone-filter.js";

describe("toPineconeFilter", () => {
  it("converts scalar equality to $eq", () => {
    expect(toPineconeFilter({ name: "Alice" })).toEqual({ name: { $eq: "Alice" } });
  });

  it("converts numeric equality to $eq", () => {
    expect(toPineconeFilter({ age: 30 })).toEqual({ age: { $eq: 30 } });
  });

  it("converts boolean equality to $eq", () => {
    expect(toPineconeFilter({ published: true })).toEqual({ published: { $eq: true } });
  });

  it("converts null to $eq: null", () => {
    expect(toPineconeFilter({ deletedAt: null })).toEqual({ deletedAt: { $eq: null } });
  });

  it("converts top-level array to $in", () => {
    expect(toPineconeFilter({ status: ["a", "b"] })).toEqual({ status: { $in: ["a", "b"] } });
  });

  it("passes through $gt", () => {
    expect(toPineconeFilter({ age: { $gt: 18 } })).toEqual({ age: { $gt: 18 } });
  });

  it("passes through $gte", () => {
    expect(toPineconeFilter({ age: { $gte: 18 } })).toEqual({ age: { $gte: 18 } });
  });

  it("passes through $lt", () => {
    expect(toPineconeFilter({ age: { $lt: 65 } })).toEqual({ age: { $lt: 65 } });
  });

  it("passes through $lte", () => {
    expect(toPineconeFilter({ age: { $lte: 65 } })).toEqual({ age: { $lte: 65 } });
  });

  it("passes through $ne", () => {
    expect(toPineconeFilter({ status: { $ne: "deleted" } })).toEqual({ status: { $ne: "deleted" } });
  });

  it("passes through $in operator", () => {
    expect(toPineconeFilter({ role: { $in: ["admin", "user"] } })).toEqual({ role: { $in: ["admin", "user"] } });
  });

  it("passes through $nin operator", () => {
    expect(toPineconeFilter({ role: { $nin: ["guest"] } })).toEqual({ role: { $nin: ["guest"] } });
  });

  it("maps $or with sub-clauses", () => {
    expect(
      toPineconeFilter({ $or: [{ name: "Alice" }, { name: "Bob" }] } as Record<string, unknown>),
    ).toEqual({ $or: [{ name: { $eq: "Alice" } }, { name: { $eq: "Bob" } }] });
  });

  it("maps $and with sub-clauses", () => {
    expect(
      toPineconeFilter({ $and: [{ age: { $gt: 18 } }, { age: { $lt: 65 } }] } as Record<string, unknown>),
    ).toEqual({ $and: [{ age: { $gt: 18 } }, { age: { $lt: 65 } }] });
  });

  it("silently ignores $like (unsupported by Pinecone)", () => {
    expect(toPineconeFilter({ name: { $like: "%alice%" } })).toEqual({ name: {} });
  });

  it("handles multiple fields in a single clause", () => {
    expect(toPineconeFilter({ name: "Alice", published: true })).toEqual({
      name: { $eq: "Alice" },
      published: { $eq: true },
    });
  });
});
