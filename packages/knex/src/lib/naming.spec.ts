import { describe, expect, it } from "vitest";
import { toCamelCase, toSnakeCase } from "./naming.js";

describe("toSnakeCase", () => {
  it("converts a single camelCase hump", () => {
    expect(toSnakeCase("userId")).toBe("user_id");
  });

  it("converts multiple humps", () => {
    expect(toSnakeCase("isEmailVerified")).toBe("is_email_verified");
  });

  it("leaves single lowercase words unchanged", () => {
    expect(toSnakeCase("id")).toBe("id");
  });

  it("lowercases a leading capital", () => {
    expect(toSnakeCase("CreatedAt")).toBe("created_at");
  });
});

describe("toCamelCase", () => {
  it("converts a single underscore", () => {
    expect(toCamelCase("user_id")).toBe("userId");
  });

  it("converts multiple underscores", () => {
    expect(toCamelCase("is_email_verified")).toBe("isEmailVerified");
  });

  it("leaves single lowercase words unchanged", () => {
    expect(toCamelCase("id")).toBe("id");
  });

  it("leaves underscore-prefixed synthetic columns unchanged", () => {
    expect(toCamelCase("_score")).toBe("_score");
  });

  it("round-trips with toSnakeCase", () => {
    expect(toCamelCase(toSnakeCase("isEmailVerified"))).toBe("isEmailVerified");
  });
});
