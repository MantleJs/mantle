import { describe, expect, it } from "vitest";
import { BadRequest } from "./errors.js";
import { parseQueryString } from "./parse-query-string.js";

describe("parseQueryString", () => {
  it("passes plain keys through unchanged", () => {
    expect(parseQueryString({ name: "Alice", role: "admin" })).toEqual({ name: "Alice", role: "admin" });
  });

  it("parses operator bracket notation", () => {
    expect(parseQueryString({ "age[$gt]": "21" })).toEqual({ age: { $gt: "21" } });
  });

  it("parses multiple operators on one field", () => {
    expect(parseQueryString({ "age[$gt]": "21", "age[$lt]": "65" })).toEqual({
      age: { $gt: "21", $lt: "65" },
    });
  });

  it("parses indexed $or clauses into arrays", () => {
    expect(parseQueryString({ "$or[0][role]": "admin", "$or[1][role]": "editor" })).toEqual({
      $or: [{ role: "admin" }, { role: "editor" }],
    });
  });

  it("parses empty-bracket keys into arrays", () => {
    expect(parseQueryString({ "tags[]": ["a", "b"] })).toEqual({ tags: ["a", "b"] });
  });

  it("turns repeated plain keys into arrays", () => {
    expect(parseQueryString({ tags: ["a", "b"] })).toEqual({ tags: ["a", "b"] });
  });

  it("parses the canonical cross-transport fixture", () => {
    expect(
      parseQueryString({
        "age[$gt]": "21",
        "$or[0][role]": "admin",
        "$or[1][role]": "editor",
        "tags[]": ["a", "b"],
      }),
    ).toEqual({
      age: { $gt: "21" },
      $or: [{ role: "admin" }, { role: "editor" }],
      tags: ["a", "b"],
    });
  });

  it("keeps values as strings (no coercion)", () => {
    expect(parseQueryString({ "age[$gt]": "21" })).toEqual({ age: { $gt: "21" } });
    expect(parseQueryString({ active: "true" })).toEqual({ active: "true" });
  });

  it("throws BadRequest beyond the depth limit", () => {
    expect(() => parseQueryString({ "a[b][c][d][e][f]": "x" })).toThrow(BadRequest);
  });

  it("accepts keys at exactly the depth limit", () => {
    expect(() => parseQueryString({ "a[b][c][d][e]": "x" })).not.toThrow();
  });

  it("treats malformed bracket keys as literals", () => {
    expect(parseQueryString({ "a[unclosed": "x" })).toEqual({ "a[unclosed": "x" });
  });
});
