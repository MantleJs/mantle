import { describe, expect, it } from "vitest";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import type { AttributeValue } from "@aws-sdk/client-dynamodb";
import { BadRequest, NESTED_QUERY_CASES } from "@mantlejs/mantle";
import { dynamodbify, buildKeyCondition, type FilterExpression, type WhereClause } from "./dynamodbify.js";

/**
 * Expand a FilterExpression's `#nN`/`:vN` aliases back into their literal names/values, so
 * assertions read like the SQL/AQL/etc. they represent instead of alias-index soup. Aliases are
 * replaced longest-first to avoid `#n1` clobbering part of `#n10`.
 */
function resolveExpression(result: FilterExpression): string {
  let resolved = result.expression;
  for (const alias of Object.keys(result.names).sort((a, b) => b.length - a.length)) {
    resolved = resolved.split(alias).join(result.names[alias]);
  }
  for (const alias of Object.keys(result.values).sort((a, b) => b.length - a.length)) {
    const value = unmarshall({ v: result.values[alias] as AttributeValue })["v"] as unknown;
    resolved = resolved.split(alias).join(JSON.stringify(value));
  }
  return resolved;
}

describe("dynamodbify", () => {
  it("generates a simple equality filter", () => {
    const result = dynamodbify({ status: "active" });
    expect(result.expression).toMatch(/^#n\d+ = :v\d+$/);
    const nameKey = Object.keys(result.names)[0];
    expect(result.names[nameKey]).toBe("status");
    const valKey = Object.keys(result.values)[0];
    expect(result.values[valKey]).toEqual({ S: "active" });
  });

  it("handles null values (attribute_not_exists)", () => {
    const result = dynamodbify({ deletedAt: null });
    expect(result.expression).toMatch(/attribute_not_exists/);
  });

  it("registers every value alias referenced by a null filter", () => {
    const result = dynamodbify({ deletedAt: null });
    const referenced = result.expression.match(/:[A-Za-z0-9_]+/g) ?? [];
    expect(referenced.length).toBeGreaterThan(0);
    for (const alias of referenced) {
      expect(result.values).toHaveProperty(alias);
    }
    const registered = Object.values(result.values);
    expect(registered).toContainEqual({ NULL: true });
  });

  it("handles $gt, $lt, $gte, $lte operators", () => {
    const gt = dynamodbify({ age: { $gt: 18 } });
    expect(gt.expression).toMatch(/>/);

    const lt = dynamodbify({ age: { $lt: 65 } });
    expect(lt.expression).toMatch(/</);

    const gte = dynamodbify({ age: { $gte: 21 } });
    expect(gte.expression).toMatch(/>=/);

    const lte = dynamodbify({ age: { $lte: 100 } });
    expect(lte.expression).toMatch(/<=/);
  });

  it("handles $ne operator for non-null", () => {
    const result = dynamodbify({ status: { $ne: "deleted" } });
    expect(result.expression).toMatch(/<>/);
  });

  it("handles $ne: null (attribute_exists)", () => {
    const result = dynamodbify({ email: { $ne: null } });
    expect(result.expression).toMatch(/attribute_exists/);
  });

  it("handles $in operator", () => {
    const result = dynamodbify({ status: { $in: ["active", "pending"] } });
    expect(result.expression).toMatch(/IN \(/);
  });

  it("handles $nin operator", () => {
    const result = dynamodbify({ status: { $nin: ["deleted", "banned"] } });
    expect(result.expression).toMatch(/NOT \(/);
    expect(result.expression).toMatch(/IN \(/);
  });

  it("handles $begins operator (begins_with)", () => {
    const result = dynamodbify({ sk: { $begins: "ORDER#" } });
    expect(result.expression).toMatch(/begins_with/);
  });

  it("handles $contains operator", () => {
    const result = dynamodbify({ tags: { $contains: "typescript" } });
    expect(result.expression).toMatch(/contains/);
  });

  it("rejects $like (no wildcard matching in DynamoDB)", () => {
    expect(() => dynamodbify({ name: { $like: "Alice" } })).toThrow(BadRequest);
    expect(() => dynamodbify({ name: { $like: "Alice" } })).toThrow(/\$like.*@mantlejs\/dynamodb/);
  });

  it("rejects unknown operators, naming the operator and adapter", () => {
    expect(() => dynamodbify({ age: { $get: 21 } })).toThrow(BadRequest);
    expect(() => dynamodbify({ age: { $get: 21 } })).toThrow(
      /Operator \$get is not supported by @mantlejs\/dynamodb\. Supported: /,
    );
  });

  it("rejects unknown operators nested in $or", () => {
    expect(() => dynamodbify({ $or: [{ age: { $get: 21 } }] })).toThrow(BadRequest);
  });

  it("handles array shorthand as $in", () => {
    const result = dynamodbify({ color: ["red", "blue"] });
    expect(result.expression).toMatch(/IN \(/);
  });

  it("handles $or operator", () => {
    const result = dynamodbify({ $or: [{ status: "active" }, { status: "pending" }] });
    expect(result.expression).toMatch(/OR/);
  });

  it("handles $and operator", () => {
    const result = dynamodbify({ $and: [{ status: "active" }, { age: { $gt: 18 } }] });
    expect(result.expression).toMatch(/AND/);
  });

  it("combines multiple fields with AND", () => {
    const result = dynamodbify({ status: "active", role: "admin" });
    expect(result.expression).toMatch(/AND/);
    const nameValues = Object.values(result.names);
    expect(nameValues).toContain("status");
    expect(nameValues).toContain("role");
  });

  describe("nested dot-path fields and $contains conformance (D-7 shared fixture)", () => {
    const expectedExpressions: Record<string, string> = {
      "dot-path equality": 'metadata.owner.name = "alice"',
      "dot-path comparison operator": "metadata.level > 4",
      "$contains scalar element on a top-level array": 'contains(tags, "blue")',
      "$contains array operand (all elements required)": '(contains(tags, "red") AND contains(tags, "blue"))',
      "$contains on a dot-path array": 'contains(metadata.tags, "a")',
      "$contains object operand (JSON superset)": '(metadata.owner.name = "alice")',
    };

    for (const testCase of NESTED_QUERY_CASES) {
      it(`translates ${testCase.name}`, () => {
        const expected = expectedExpressions[testCase.name];
        expect(expected).toBeDefined();
        const result = dynamodbify(testCase.where as WhereClause);
        expect(resolveExpression(result)).toBe(expected);
      });
    }

    it("builds a real multi-segment ExpressionAttributeNames alias for a dot-path field", () => {
      const result = dynamodbify({ "metadata.owner.name": "alice" });
      expect(result.expression).toMatch(/^#n\d+\.#n\d+\.#n\d+ = :v\d+$/);
      expect(Object.values(result.names).sort()).toEqual(["metadata", "name", "owner"]);
    });

    it("requires every element for an empty $contains array (vacuously true via attribute_exists)", () => {
      const result = dynamodbify({ tags: { $contains: [] } });
      expect(result.expression).toMatch(/^attribute_exists\(#n\d+\)$/);
    });

    it("supports null-checks, $in, and $nin combined with a dot-path field — unlike SQL adapters, DynamoDB's expression language treats a nested path like any other operand", () => {
      const nullResult = dynamodbify({ "metadata.owner.name": null });
      expect(resolveExpression(nullResult)).toBe(
        "(attribute_not_exists(metadata.owner.name) OR metadata.owner.name = null)",
      );

      const inResult = dynamodbify({ "metadata.owner.name": { $in: ["alice", "bob"] } });
      expect(resolveExpression(inResult)).toBe('metadata.owner.name IN ("alice", "bob")');

      const shorthandResult = dynamodbify({ "metadata.owner.name": ["alice", "bob"] });
      expect(resolveExpression(shorthandResult)).toBe('metadata.owner.name IN ("alice", "bob")');

      const ninResult = dynamodbify({ "metadata.owner.name": { $nin: ["alice", "bob"] } });
      expect(resolveExpression(ninResult)).toBe('NOT (metadata.owner.name IN ("alice", "bob"))');
    });

    it("maps dot-path fields through toField for the root segment call site, leaving segments literal", () => {
      const result = dynamodbify({ "metadata.owner.name": "alice" }, (field) => field);
      expect(resolveExpression(result)).toBe('metadata.owner.name = "alice"');
    });
  });
});

describe("buildKeyCondition", () => {
  it("routes partition key to key condition", () => {
    const result = buildKeyCondition("pk", "sk", { pk: "USER#1" });
    expect(result.keyCondition).toMatch(/= :v\d+/);
    expect(result.filterCondition).toBeUndefined();
  });

  it("routes non-key fields to filter condition", () => {
    const result = buildKeyCondition("pk", "sk", { pk: "USER#1", status: "active" });
    expect(result.keyCondition).toBeTruthy();
    expect(result.filterCondition).toBeTruthy();
    expect(result.filterCondition).toMatch(/= :v\d+/);
  });

  it("builds filter condition when no PK match", () => {
    const result = buildKeyCondition("pk", "sk", { status: "active" });
    expect(result.keyCondition).toBe("");
    expect(result.filterCondition).toMatch(/= :v\d+/);
  });
});

describe("toField", () => {
  const shout = (field: string) => field.toUpperCase();

  it("dynamodbify maps a top-level field name to its ExpressionAttributeNames value", () => {
    const result = dynamodbify({ userId: 1 }, shout);
    expect(Object.values(result.names)).toEqual(["USERID"]);
  });

  it("dynamodbify maps field names inside $or branches", () => {
    const result = dynamodbify({ $or: [{ userId: 1 }, { name: "Bob" }] }, shout);
    expect(Object.values(result.names).sort()).toEqual(["NAME", "USERID"]);
  });

  it("buildKeyCondition maps the mapped partition key name into ExpressionAttributeNames", () => {
    const result = buildKeyCondition("pk", "sk", { pk: "USER#1" }, shout);
    expect(Object.values(result.names)).toEqual(["PK"]);
  });

  it("buildKeyCondition maps non-key filter field names too", () => {
    const result = buildKeyCondition("pk", "sk", { pk: "USER#1", status: "active" }, shout);
    expect(Object.values(result.names).sort()).toEqual(["PK", "STATUS"]);
  });
});
