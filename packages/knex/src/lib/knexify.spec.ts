import { describe, expect, it, vi } from "vitest";
import type { Knex } from "knex";
import { BadRequest } from "@mantlejs/mantle";
import { knexify, mapWhereFields } from "./knexify.js";
import type { WhereClause } from "./knexify.js";

function makeBuilder(client = "pg") {
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
    whereJsonSupersetOf: vi.fn(),
    whereJsonPath: vi.fn(),
  };
  // All methods return the same builder for chaining
  for (const key of Object.keys(qb)) {
    qb[key].mockReturnValue(qb);
  }
  (qb as Record<string, unknown>)["client"] = { config: { client } };
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
      expect((qb as unknown as Record<string, ReturnType<typeof vi.fn>>)["where"]).toHaveBeenCalledWith("age", "=", 30);
    });

    it("applies whereNull for null values", () => {
      const qb = makeBuilder();
      knexify(qb, { deletedAt: null });
      expect((qb as unknown as Record<string, ReturnType<typeof vi.fn>>)["whereNull"]).toHaveBeenCalledWith(
        "deletedAt",
      );
    });

    it("applies whereIn for array values", () => {
      const qb = makeBuilder();
      knexify(qb, { id: [1, 2, 3] });
      expect((qb as unknown as Record<string, ReturnType<typeof vi.fn>>)["whereIn"]).toHaveBeenCalledWith(
        "id",
        [1, 2, 3],
      );
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

  describe("$contains (jsonb/JSON containment, PostgreSQL + MySQL only)", () => {
    it("maps an object operand to whereJsonSupersetOf on pg", () => {
      const qb = makeBuilder("pg");
      knexify(qb, { metadata: { $contains: { owner: { name: "alice" } } } });
      expect((qb as unknown as Record<string, ReturnType<typeof vi.fn>>)["whereJsonSupersetOf"]).toHaveBeenCalledWith(
        "metadata",
        { owner: { name: "alice" } },
      );
    });

    it("wraps a scalar operand in an array (contains-element semantics)", () => {
      const qb = makeBuilder("postgresql");
      knexify(qb, { tags: { $contains: "blue" } });
      expect((qb as unknown as Record<string, ReturnType<typeof vi.fn>>)["whereJsonSupersetOf"]).toHaveBeenCalledWith(
        "tags",
        ["blue"],
      );
    });

    it("passes an array operand through unchanged", () => {
      const qb = makeBuilder("pg");
      knexify(qb, { tags: { $contains: ["red", "blue"] } });
      expect((qb as unknown as Record<string, ReturnType<typeof vi.fn>>)["whereJsonSupersetOf"]).toHaveBeenCalledWith(
        "tags",
        ["red", "blue"],
      );
    });

    it("also maps to whereJsonSupersetOf on mysql2 — MySQL's JSON_CONTAINS via the same knex method", () => {
      const qb = makeBuilder("mysql2");
      knexify(qb, { tags: { $contains: "blue" } });
      expect((qb as unknown as Record<string, ReturnType<typeof vi.fn>>)["whereJsonSupersetOf"]).toHaveBeenCalledWith(
        "tags",
        ["blue"],
      );
    });

    it("rejects $contains on clients with no native JSON-superset function, naming the operator and client", () => {
      for (const client of ["sqlite3", "mssql"]) {
        const qb = makeBuilder(client);
        expect(() => knexify(qb, { tags: { $contains: "blue" } })).toThrow(BadRequest);
        expect(() => knexify(qb, { tags: { $contains: "blue" } })).toThrow(
          /\$contains is only supported by @mantlejs\/knex on PostgreSQL and MySQL/,
        );
      }
    });
  });

  describe("dot-path (nested JSON field) support", () => {
    it("addresses a nested field via whereJsonPath for equality", () => {
      const qb = makeBuilder("pg");
      knexify(qb, { "metadata.owner.name": "alice" });
      expect((qb as unknown as Record<string, ReturnType<typeof vi.fn>>)["whereJsonPath"]).toHaveBeenCalledWith(
        "metadata",
        "$.owner.name",
        "=",
        "alice",
      );
    });

    it("addresses a nested field via whereJsonPath for comparison operators", () => {
      const qb = makeBuilder("mysql2");
      knexify(qb, { "metadata.level": { $gt: 4 } });
      expect((qb as unknown as Record<string, ReturnType<typeof vi.fn>>)["whereJsonPath"]).toHaveBeenCalledWith(
        "metadata",
        "$.level",
        ">",
        4,
      );
    });

    it("works for sqlite3 and mssql too", () => {
      for (const client of ["sqlite3", "mssql"]) {
        const qb = makeBuilder(client);
        knexify(qb, { "metadata.owner.name": "alice" });
        expect((qb as unknown as Record<string, ReturnType<typeof vi.fn>>)["whereJsonPath"]).toHaveBeenCalledWith(
          "metadata",
          "$.owner.name",
          "=",
          "alice",
        );
      }
    });

    it("supports $ne, $like, $notlike on a nested field", () => {
      const qb = makeBuilder("pg");
      knexify(qb, { "metadata.owner.name": { $ne: "alice" } });
      expect((qb as unknown as Record<string, ReturnType<typeof vi.fn>>)["whereJsonPath"]).toHaveBeenCalledWith(
        "metadata",
        "$.owner.name",
        "!=",
        "alice",
      );

      knexify(qb, { "metadata.owner.name": { $like: "al%" } });
      expect((qb as unknown as Record<string, ReturnType<typeof vi.fn>>)["whereJsonPath"]).toHaveBeenCalledWith(
        "metadata",
        "$.owner.name",
        "like",
        "al%",
      );

      knexify(qb, { "metadata.owner.name": { $notlike: "al%" } });
      expect((qb as unknown as Record<string, ReturnType<typeof vi.fn>>)["whereJsonPath"]).toHaveBeenCalledWith(
        "metadata",
        "$.owner.name",
        "not like",
        "al%",
      );
    });

    it("$ilike on a nested field works on pg", () => {
      const qb = makeBuilder("pg");
      knexify(qb, { "metadata.owner.name": { $ilike: "AL%" } });
      expect((qb as unknown as Record<string, ReturnType<typeof vi.fn>>)["whereJsonPath"]).toHaveBeenCalledWith(
        "metadata",
        "$.owner.name",
        "ilike",
        "AL%",
      );
    });

    it("rejects $ilike on a nested field for non-pg clients", () => {
      const qb = makeBuilder("mysql2");
      expect(() => knexify(qb, { "metadata.owner.name": { $ilike: "AL%" } })).toThrow(BadRequest);
      expect(() => knexify(qb, { "metadata.owner.name": { $ilike: "AL%" } })).toThrow(
        /\$ilike on nested field .* is only supported by @mantlejs\/knex on PostgreSQL/,
      );
    });

    it("rejects null checks on a nested field", () => {
      const qb = makeBuilder("pg");
      expect(() => knexify(qb, { "metadata.owner.name": null })).toThrow(BadRequest);
      expect(() => knexify(qb, { "metadata.owner.name": null })).toThrow(/Null checks on nested field/);
    });

    it("rejects the $in array shorthand on a nested field", () => {
      const qb = makeBuilder("pg");
      expect(() => knexify(qb, { "metadata.owner.name": ["alice", "bob"] })).toThrow(BadRequest);
      expect(() => knexify(qb, { "metadata.owner.name": { $in: ["alice", "bob"] } })).toThrow(BadRequest);
      expect(() => knexify(qb, { "metadata.owner.name": { $nin: ["alice", "bob"] } })).toThrow(BadRequest);
    });

    it("$contains on a nested field maps to a raw JSON-containment expression on pg", () => {
      const qb = makeBuilder("pg");
      knexify(qb, { "metadata.tags": { $contains: "a" } });
      expect((qb as unknown as Record<string, ReturnType<typeof vi.fn>>)["whereRaw"]).toHaveBeenCalledWith(
        "?? #> ? @> ?::jsonb",
        ["metadata", "{tags}", JSON.stringify(["a"])],
      );
    });

    it("$contains on a nested field maps to JSON_CONTAINS on mysql", () => {
      const qb = makeBuilder("mysql2");
      knexify(qb, { "metadata.tags": { $contains: "a" } });
      expect((qb as unknown as Record<string, ReturnType<typeof vi.fn>>)["whereRaw"]).toHaveBeenCalledWith(
        "JSON_CONTAINS(??, ?, ?)",
        ["metadata", JSON.stringify(["a"]), "$.tags"],
      );
    });

    it("rejects $contains on a nested field for sqlite/mssql", () => {
      for (const client of ["sqlite3", "mssql"]) {
        const qb = makeBuilder(client);
        expect(() => knexify(qb, { "metadata.tags": { $contains: "a" } })).toThrow(BadRequest);
      }
    });

    it("rejects a nested field entirely on an unrecognized client", () => {
      const qb = makeBuilder("oracledb");
      expect(() => knexify(qb, { "metadata.owner.name": "alice" })).toThrow(BadRequest);
      expect(() => knexify(qb, { "metadata.owner.name": "alice" })).toThrow(
        /Nested field "metadata\.owner\.name" is not supported by @mantlejs\/knex on this client/,
      );
    });

    it("composes with $or/$and", () => {
      const qb = makeBuilder("pg");
      knexify(qb, { $or: [{ "metadata.owner.name": "alice" }, { status: "active" }] });
      expect((qb as unknown as Record<string, ReturnType<typeof vi.fn>>)["where"]).toHaveBeenCalledWith(
        expect.any(Function),
      );
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

describe("mapWhereFields", () => {
  const shout = (field: string) => field.toUpperCase();

  it("renames top-level field keys, leaving values untouched", () => {
    expect(mapWhereFields({ userId: 1, name: { $ne: "Bob" } }, shout)).toEqual({
      USERID: 1,
      NAME: { $ne: "Bob" },
    });
  });

  it("recurses into $or branches without renaming the $or key itself", () => {
    const where: WhereClause = { $or: [{ userId: 1 }, { name: "Bob" }] };
    expect(mapWhereFields(where, shout)).toEqual({ $or: [{ USERID: 1 }, { NAME: "Bob" }] });
  });

  it("recurses into $and branches without renaming the $and key itself", () => {
    const where: WhereClause = { $and: [{ userId: 1 }, { name: "Bob" }] };
    expect(mapWhereFields(where, shout)).toEqual({ $and: [{ USERID: 1 }, { NAME: "Bob" }] });
  });

  it("maps only the root segment of a dot-path field, leaving nested JSON keys untouched", () => {
    // The nested segments ("ownerName") are JSON keys inside the stored document, not SQL
    // identifiers — a columnCase/fieldMap convention like snake_case must never reformat them.
    expect(mapWhereFields({ "userInfo.ownerName": "alice" }, shout)).toEqual({
      "USERINFO.ownerName": "alice",
    });
  });

  it("maps the dot-path root inside $or/$and branches too", () => {
    const where: WhereClause = { $or: [{ "userInfo.ownerName": "alice" }] };
    expect(mapWhereFields(where, shout)).toEqual({ $or: [{ "USERINFO.ownerName": "alice" }] });
  });
});
