import { describe, it, expect } from "vitest";
import { toPascalCase, toCamelCase, toKebabCase } from "./utils.js";

describe("toPascalCase", () => {
  it("converts kebab-case to PascalCase", () => {
    expect(toPascalCase("user-profile")).toBe("UserProfile");
  });

  it("converts snake_case to PascalCase", () => {
    expect(toPascalCase("user_profile")).toBe("UserProfile");
  });

  it("handles single word", () => {
    expect(toPascalCase("users")).toBe("Users");
  });

  it("preserves existing PascalCase", () => {
    expect(toPascalCase("UserProfile")).toBe("UserProfile");
  });
});

describe("toCamelCase", () => {
  it("converts kebab-case to camelCase", () => {
    expect(toCamelCase("user-profile")).toBe("userProfile");
  });

  it("converts single word to lowercase", () => {
    expect(toCamelCase("Users")).toBe("users");
  });
});

describe("toKebabCase", () => {
  it("converts PascalCase to kebab-case", () => {
    expect(toKebabCase("UserProfile")).toBe("user-profile");
  });

  it("converts camelCase to kebab-case", () => {
    expect(toKebabCase("userProfile")).toBe("user-profile");
  });

  it("preserves existing kebab-case", () => {
    expect(toKebabCase("user-profile")).toBe("user-profile");
  });

  it("handles single lowercase word unchanged", () => {
    expect(toKebabCase("users")).toBe("users");
  });
});
