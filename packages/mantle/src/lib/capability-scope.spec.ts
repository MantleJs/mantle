import { describe, expect, it } from "vitest";
import type { CapabilityScope } from "./capability-scope.js";
import { matchesCapabilityScope } from "./capability-scope.js";

describe("matchesCapabilityScope", () => {
  it("denies a path absent from the scope", () => {
    expect(matchesCapabilityScope({}, "articles", "find")).toBe(false);
    expect(matchesCapabilityScope({ users: true }, "articles", "find")).toBe(false);
  });

  it("allows every method under a path-level wildcard", () => {
    const scope: CapabilityScope = { articles: true };
    expect(matchesCapabilityScope(scope, "articles", "find")).toBe(true);
    expect(matchesCapabilityScope(scope, "articles", "remove")).toBe(true);
  });

  it("allows only listed methods under an explicit method list", () => {
    const scope = { articles: ["find", "get"] };
    expect(matchesCapabilityScope(scope, "articles", "find")).toBe(true);
    expect(matchesCapabilityScope(scope, "articles", "get")).toBe(true);
    expect(matchesCapabilityScope(scope, "articles", "remove")).toBe(false);
  });

  it("denies a method not present in an empty method list", () => {
    expect(matchesCapabilityScope({ articles: [] }, "articles", "find")).toBe(false);
  });
});
