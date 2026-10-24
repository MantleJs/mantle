import { BadRequest } from "@mantlejs/mantle";
import { assertPolicyName, limitItem, mergeListItem, policyItem } from "./headers.js";

describe("RateLimit header format (draft-ietf-httpapi-ratelimit-headers-11)", () => {
  it("formats a RateLimit-Policy member", () => {
    expect(policyItem("default", 100, 60)).toBe('"default";q=100;w=60');
  });

  it("formats a RateLimit member", () => {
    expect(limitItem("default", 42, 18)).toBe('"default";r=42;t=18');
  });

  it("rounds t up to whole seconds and clamps r and t at zero", () => {
    expect(limitItem("default", 3, 17.2)).toBe('"default";r=3;t=18');
    expect(limitItem("default", -5, -1)).toBe('"default";r=0;t=0');
  });

  it("merges policies into one List-valued header, one member per policy", () => {
    const one = mergeListItem(undefined, policyItem("default", 100, 60));
    const two = mergeListItem(one, policyItem("writes", 10, 60));
    expect(two).toBe('"default";q=100;w=60, "writes";q=10;w=60');
  });

  it("replaces an existing member for the same policy instead of duplicating it", () => {
    const first = mergeListItem(undefined, limitItem("default", 9, 60));
    const both = mergeListItem(first, limitItem("writes", 4, 30));
    expect(mergeListItem(both, limitItem("default", 8, 59))).toBe('"writes";r=4;t=30, "default";r=8;t=59');
  });

  it.each(["default", "per-user", "api.v2:writes", "a".repeat(64)])("accepts the policy name %j", (name) => {
    expect(() => assertPolicyName(name)).not.toThrow();
  });

  it.each(["", "has space", 'quo"te', "semi;colon", "com,ma", "ünï", "a".repeat(65)])(
    "rejects the policy name %j with BadRequest",
    (name) => {
      expect(() => assertPolicyName(name)).toThrow(BadRequest);
    },
  );
});
