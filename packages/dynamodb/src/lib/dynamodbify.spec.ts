import { describe, expect, it } from "vitest";
import { dynamodbify, buildKeyCondition } from "./dynamodbify.js";

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

  it("handles $like operator as contains()", () => {
    const result = dynamodbify({ name: { $like: "Alice" } });
    expect(result.expression).toMatch(/contains/);
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
