import { parseQueryString } from "@mantlejs/mantle";
import { describe, expect, it } from "vitest";
import { serializeQuery } from "./serialize-query.js";

/** Re-flatten a query string the way an HTTP transport hands it to parseQueryString. */
function toFlat(queryString: string): Record<string, string | string[]> {
  const flat: Record<string, string | string[]> = {};
  for (const [key, value] of new URLSearchParams(queryString)) {
    const existing = flat[key];
    if (existing === undefined) flat[key] = value;
    else if (Array.isArray(existing)) existing.push(value);
    else flat[key] = [existing, value];
  }
  return flat;
}

describe("serializeQuery", () => {
  it("serializes scalar equality", () => {
    expect(serializeQuery({ name: "alice", age: 21, active: true })).toBe("name=alice&age=21&active=true");
  });

  it("serializes operator objects with bracket notation", () => {
    expect(serializeQuery({ age: { $gt: 21, $lte: 65 } })).toBe(
      `${encodeURIComponent("age[$gt]")}=21&${encodeURIComponent("age[$lte]")}=65`,
    );
  });

  it("serializes arrays with explicit indices", () => {
    const qs = serializeQuery({ tags: ["a", "b"] });
    expect(decodeURIComponent(qs)).toBe("tags[0]=a&tags[1]=b");
  });

  it("drops undefined values and serializes null as empty string", () => {
    expect(serializeQuery({ a: undefined, b: null })).toBe("b=");
  });

  it("round-trips through @mantlejs/mantle parseQueryString", () => {
    const query = {
      name: "alice",
      age: { $gt: 21 },
      $or: [{ role: "admin" }, { role: "editor" }],
      tags: ["a", "b"],
      $limit: 10,
      $sort: { name: "asc" },
    };
    const parsed = parseQueryString(toFlat(serializeQuery(query)));
    expect(parsed).toEqual({
      name: "alice",
      age: { $gt: "21" },
      $or: [{ role: "admin" }, { role: "editor" }],
      tags: ["a", "b"],
      $limit: "10",
      $sort: { name: "asc" },
    });
  });

  it("round-trips $in inside a nested field", () => {
    const parsed = parseQueryString(toFlat(serializeQuery({ role: { $in: ["admin", "editor"] } })));
    expect(parsed).toEqual({ role: { $in: ["admin", "editor"] } });
  });
});
