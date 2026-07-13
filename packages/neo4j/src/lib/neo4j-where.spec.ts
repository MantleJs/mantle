import { describe, it, expect } from "vitest";
import { BadRequest } from "@mantlejs/mantle";
import { toNeo4jWhere } from "./neo4j-where.js";

describe("toNeo4jWhere", () => {
  describe("equality", () => {
    it("maps a string value to n.field = $p", () => {
      const { cypher, params } = toNeo4jWhere({ category: "tech" });
      expect(cypher).toBe("n.category = $_w_0");
      expect(params["_w_0"]).toBe("tech");
    });

    it("maps a numeric value", () => {
      const { cypher, params } = toNeo4jWhere({ score: 42 });
      expect(cypher).toBe("n.score = $_w_0");
      expect(params["_w_0"]).toBe(42);
    });

    it("maps a boolean value", () => {
      const { cypher, params } = toNeo4jWhere({ active: true });
      expect(cypher).toBe("n.active = $_w_0");
      expect(params["_w_0"]).toBe(true);
    });
  });

  describe("null handling", () => {
    it("maps null to IS NULL", () => {
      const { cypher, params } = toNeo4jWhere({ deletedAt: null });
      expect(cypher).toBe("n.deletedAt IS NULL");
      expect(Object.keys(params)).toHaveLength(0);
    });

    it("maps $ne: null to IS NOT NULL", () => {
      const { cypher } = toNeo4jWhere({ deletedAt: { $ne: null } });
      expect(cypher).toBe("n.deletedAt IS NOT NULL");
    });
  });

  describe("array shorthand", () => {
    it("maps an array value to IN clause", () => {
      const { cypher, params } = toNeo4jWhere({ status: ["active", "pending"] });
      expect(cypher).toBe("n.status IN $_w_0");
      expect(params["_w_0"]).toEqual(["active", "pending"]);
    });
  });

  describe("comparison operators", () => {
    it("maps $gt", () => {
      const { cypher, params } = toNeo4jWhere({ score: { $gt: 5 } });
      expect(cypher).toBe("n.score > $_w_0");
      expect(params["_w_0"]).toBe(5);
    });

    it("maps $gte", () => {
      const { cypher, params } = toNeo4jWhere({ score: { $gte: 5 } });
      expect(cypher).toBe("n.score >= $_w_0");
      expect(params["_w_0"]).toBe(5);
    });

    it("maps $lt", () => {
      const { cypher, params } = toNeo4jWhere({ score: { $lt: 10 } });
      expect(cypher).toBe("n.score < $_w_0");
      expect(params["_w_0"]).toBe(10);
    });

    it("maps $lte", () => {
      const { cypher, params } = toNeo4jWhere({ score: { $lte: 10 } });
      expect(cypher).toBe("n.score <= $_w_0");
      expect(params["_w_0"]).toBe(10);
    });

    it("maps combined $gte and $lt", () => {
      const { cypher } = toNeo4jWhere({ age: { $gte: 18, $lt: 65 } });
      expect(cypher).toContain("n.age >= $_w_");
      expect(cypher).toContain("n.age < $_w_");
    });
  });

  describe("$ne operator", () => {
    it("maps $ne value to <> condition", () => {
      const { cypher, params } = toNeo4jWhere({ status: { $ne: "deleted" } });
      expect(cypher).toBe("n.status <> $_w_0");
      expect(params["_w_0"]).toBe("deleted");
    });
  });

  describe("$in and $nin operators", () => {
    it("maps $in to IN clause", () => {
      const { cypher, params } = toNeo4jWhere({ tag: { $in: ["a", "b"] } });
      expect(cypher).toBe("n.tag IN $_w_0");
      expect(params["_w_0"]).toEqual(["a", "b"]);
    });

    it("maps $nin to NOT IN clause", () => {
      const { cypher, params } = toNeo4jWhere({ tag: { $nin: ["x", "y"] } });
      expect(cypher).toBe("NOT n.tag IN $_w_0");
      expect(params["_w_0"]).toEqual(["x", "y"]);
    });
  });

  describe("$like operator", () => {
    it("maps %pattern% to CONTAINS", () => {
      const { cypher, params } = toNeo4jWhere({ title: { $like: "%hello%" } });
      expect(cypher).toBe("n.title CONTAINS $_w_0");
      expect(params["_w_0"]).toBe("hello");
    });

    it("maps %pattern to ENDS WITH", () => {
      const { cypher, params } = toNeo4jWhere({ name: { $like: "%world" } });
      expect(cypher).toBe("n.name ENDS WITH $_w_0");
      expect(params["_w_0"]).toBe("world");
    });

    it("maps pattern% to STARTS WITH", () => {
      const { cypher, params } = toNeo4jWhere({ name: { $like: "foo%" } });
      expect(cypher).toBe("n.name STARTS WITH $_w_0");
      expect(params["_w_0"]).toBe("foo");
    });
  });

  describe("$ilike operator", () => {
    it("maps $ilike to toLower CONTAINS", () => {
      const { cypher, params } = toNeo4jWhere({ title: { $ilike: "%hello%" } });
      expect(cypher).toBe("toLower(n.title) CONTAINS $_w_0");
      expect(params["_w_0"]).toBe("hello");
    });
  });

  describe("$notlike operator", () => {
    it("maps $notlike to NOT CONTAINS", () => {
      const { cypher, params } = toNeo4jWhere({ title: { $notlike: "%spam%" } });
      expect(cypher).toBe("NOT (n.title CONTAINS $_w_0)");
      expect(params["_w_0"]).toBe("spam");
    });
  });

  describe("$or and $and logical operators", () => {
    it("maps $or to OR expression", () => {
      const { cypher } = toNeo4jWhere({ $or: [{ status: "active" }, { status: "pending" }] });
      expect(cypher).toContain(" OR ");
      expect(cypher).toMatch(/n\.status = \$_w_\d/);
    });

    it("maps $and to AND expression", () => {
      const { cypher } = toNeo4jWhere({ $and: [{ status: "active" }, { score: { $gte: 5 } }] });
      expect(cypher).toContain(" AND ");
    });
  });

  describe("multiple fields", () => {
    it("combines multiple fields with AND", () => {
      const { cypher } = toNeo4jWhere({ category: "tech", active: true });
      expect(cypher).toContain("n.category = $_w_");
      expect(cypher).toContain("n.active = $_w_");
      expect(cypher).toContain(" AND ");
    });
  });

  describe("empty filter", () => {
    it("returns 'true' for an empty where clause", () => {
      const { cypher, params } = toNeo4jWhere({});
      expect(cypher).toBe("true");
      expect(Object.keys(params)).toHaveLength(0);
    });
  });

  describe("custom alias", () => {
    it("uses provided alias instead of 'n'", () => {
      const { cypher } = toNeo4jWhere({ name: "Alice" }, "m");
      expect(cypher).toBe("m.name = $_w_0");
    });
  });

  describe("field name whitelisting", () => {
    it("throws BadRequest for an injection attempt in an equality key", () => {
      expect(() => toNeo4jWhere({ "name = 'x' RETURN n //": "Alice" })).toThrow(BadRequest);
    });

    it("throws BadRequest for an injection attempt in an operator key", () => {
      expect(() => toNeo4jWhere({ "age} RETURN n //": { $gt: 1 } })).toThrow(BadRequest);
    });

    it("throws BadRequest for an injection attempt in a null-check key", () => {
      expect(() => toNeo4jWhere({ "x IS NULL OR true //": null })).toThrow(BadRequest);
    });

    it("throws BadRequest for an injection attempt inside $or branches", () => {
      expect(() => toNeo4jWhere({ $or: [{ "bad key": "v" }] })).toThrow(BadRequest);
    });

    it("names the offending field in the error message", () => {
      expect(() => toNeo4jWhere({ "bad key": "v" })).toThrow("Invalid field name: bad key");
    });

    it("allows underscore-prefixed and alphanumeric identifiers", () => {
      expect(() => toNeo4jWhere({ _private: 1, field2: "x" })).not.toThrow();
    });
  });
});
