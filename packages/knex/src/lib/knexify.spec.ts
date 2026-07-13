import { describe, expect, it, vi } from "vitest";
import type { Knex } from "knex";
import { BadRequest } from "@mantlejs/mantle";
import { knexify } from "./knexify.js";

function makeBuilder() {
  const qb: Record<string, ReturnType<typeof vi.fn>> = {
    where: vi.fn(),
    whereNot: vi.fn(),
    whereNull: vi.fn(),
    whereNotNull: vi.fn(),
    whereIn: vi.fn(),
    whereNotIn: vi.fn(),
    whereLike: vi.fn(),
    whereRaw: vi.fn(),
    whereILike: vi.fn(),
  };
  // All methods return the same builder for chaining
  for (const key of Object.keys(qb)) {
    qb[key].mockReturnValue(qb);
  }
  return qb as unknown as Knex.QueryBuilder;
}

describe("knexify", () => {
  describe("equality and primitives", () => {
    it("applies string equality", () => {
      const qb = makeBuilder();
      knexify(qb, { name: "Alice" });
      expect((qb as unknown as Record<string, ReturnType<typeof vi.fn>>)["where"]).toHaveBeenCalledWith(
        "name",
        "=",
        "Alice",
      );
    });

    it("applies number equality", () => {
      const qb = makeBuilder();
      knexify(qb, { age: 30 });
      expect((qb as unknown as Record<string, ReturnType<typeof vi.fn>>)["where"]).toHaveBeenCalledWith(
        "age",
        "=",
        30,
      );
    });

    it("applies whereNull for null values", () => {
      const qb = makeBuilder();
      knexify(qb, { deletedAt: null });
      expect((qb as unknown as Record<string, ReturnType<typeof vi.fn>>)["whereNull"]).toHaveBeenCalledWith("deletedAt");
    });

    it("applies whereIn for array values", () => {
      const qb = makeBuilder();
      knexify(qb, { id: [1, 2, 3] });
      expect((qb as unknown as Record<string, ReturnType<typeof vi.fn>>)["whereIn"]).toHaveBeenCalledWith("id", [
        1, 2, 3,
      ]);
    });
  });

  describe("comparison operators", () => {
    it("$gt applies >", () => {
      const qb = makeBuilder();
      knexify(qb, { age: { $gt: 18 } });
      expect((qb as unknown as Record<string, ReturnType<typeof vi.fn>>)["where"]).toHaveBeenCalledWith("age", ">", 18);
    });

    it("$gte applies >=", () => {
      const qb = makeBuilder();
      knexify(qb, { age: { $gte: 18 } });
      expect((qb as unknown as Record<string, ReturnType<typeof vi.fn>>)["where"]).toHaveBeenCalledWith(
        "age",
        ">=",
        18,
      );
    });

    it("$lt applies <", () => {
      const qb = makeBuilder();
      knexify(qb, { age: { $lt: 65 } });
      expect((qb as unknown as Record<string, ReturnType<typeof vi.fn>>)["where"]).toHaveBeenCalledWith("age", "<", 65);
    });

    it("$lte applies <=", () => {
      const qb = makeBuilder();
      knexify(qb, { age: { $lte: 65 } });
      expect((qb as unknown as Record<string, ReturnType<typeof vi.fn>>)["where"]).toHaveBeenCalledWith(
        "age",
        "<=",
        65,
      );
    });

    it("combines multiple comparison operators on the same field", () => {
      const qb = makeBuilder();
      knexify(qb, { age: { $gte: 18, $lt: 65 } });
      const whereFn = (qb as unknown as Record<string, ReturnType<typeof vi.fn>>)["where"];
      expect(whereFn).toHaveBeenCalledWith("age", ">=", 18);
      expect(whereFn).toHaveBeenCalledWith("age", "<", 65);
    });
  });

  describe("$ne operator", () => {
    it("$ne with a value applies whereNot", () => {
      const qb = makeBuilder();
      knexify(qb, { status: { $ne: "inactive" } });
      expect((qb as unknown as Record<string, ReturnType<typeof vi.fn>>)["whereNot"]).toHaveBeenCalledWith(
        "status",
        "inactive",
      );
    });

    it("$ne with null applies whereNotNull", () => {
      const qb = makeBuilder();
      knexify(qb, { deletedAt: { $ne: null } });
      expect((qb as unknown as Record<string, ReturnType<typeof vi.fn>>)["whereNotNull"]).toHaveBeenCalledWith(
        "deletedAt",
      );
    });
  });

  describe("$in and $nin operators", () => {
    it("$in applies whereIn", () => {
      const qb = makeBuilder();
      knexify(qb, { role: { $in: ["admin", "moderator"] } });
      expect((qb as unknown as Record<string, ReturnType<typeof vi.fn>>)["whereIn"]).toHaveBeenCalledWith("role", [
        "admin",
        "moderator",
      ]);
    });

    it("$nin applies whereNotIn", () => {
      const qb = makeBuilder();
      knexify(qb, { status: { $nin: ["banned", "deleted"] } });
      expect((qb as unknown as Record<string, ReturnType<typeof vi.fn>>)["whereNotIn"]).toHaveBeenCalledWith("status", [
        "banned",
        "deleted",
      ]);
    });
  });

  describe("pattern matching operators", () => {
    it("$like applies whereLike", () => {
      const qb = makeBuilder();
      knexify(qb, { name: { $like: "Al%" } });
      expect((qb as unknown as Record<string, ReturnType<typeof vi.fn>>)["whereLike"]).toHaveBeenCalledWith(
        "name",
        "Al%",
      );
    });

    it("$notlike applies NOT LIKE via whereRaw", () => {
      const qb = makeBuilder();
      knexify(qb, { name: { $notlike: "Al%" } });
      expect((qb as unknown as Record<string, ReturnType<typeof vi.fn>>)["whereRaw"]).toHaveBeenCalledWith(
        "?? NOT LIKE ?",
        ["name", "Al%"],
      );
    });

    it("$ilike applies whereILike (PostgreSQL case-insensitive)", () => {
      const qb = makeBuilder();
      knexify(qb, { email: { $ilike: "%@example.com" } });
      expect((qb as unknown as Record<string, ReturnType<typeof vi.fn>>)["whereILike"]).toHaveBeenCalledWith(
        "email",
        "%@example.com",
      );
    });
  });

  describe("$or operator", () => {
    it("wraps conditions in an OR group", () => {
      const qb = makeBuilder();
      knexify(qb, { $or: [{ name: "Alice" }, { name: "Bob" }] });
      expect((qb as unknown as Record<string, ReturnType<typeof vi.fn>>)["where"]).toHaveBeenCalledWith(
        expect.any(Function),
      );
    });
  });

  describe("$and operator", () => {
    it("wraps conditions in an AND group", () => {
      const qb = makeBuilder();
      knexify(qb, { $and: [{ age: { $gte: 18 } }, { age: { $lt: 65 } }] });
      expect((qb as unknown as Record<string, ReturnType<typeof vi.fn>>)["where"]).toHaveBeenCalledWith(
        expect.any(Function),
      );
    });
  });

  describe("unsupported operators", () => {
    it("rejects unknown operators, naming the operator and adapter", () => {
      const qb = makeBuilder();
      expect(() => knexify(qb, { age: { $get: 21 } })).toThrow(BadRequest);
      expect(() => knexify(qb, { age: { $get: 21 } })).toThrow(
        /Operator \$get is not supported by @mantlejs\/knex\. Supported: /,
      );
    });

    it("rejects unknown operators nested in $or", () => {
      const qb = makeBuilder();
      expect(() => knexify(qb, { $or: [{ age: { $get: 21 } }] })).toThrow(BadRequest);
    });
  });

  describe("multiple fields", () => {
    it("applies all conditions when multiple fields are provided", () => {
      const qb = makeBuilder();
      knexify(qb, { name: "Alice", age: { $gte: 18 }, deletedAt: null });
      const whereFn = (qb as unknown as Record<string, ReturnType<typeof vi.fn>>)["where"];
      const whereNullFn = (qb as unknown as Record<string, ReturnType<typeof vi.fn>>)["whereNull"];
      expect(whereFn).toHaveBeenCalledWith("name", "=", "Alice");
      expect(whereFn).toHaveBeenCalledWith("age", ">=", 18);
      expect(whereNullFn).toHaveBeenCalledWith("deletedAt");
    });
  });
});
