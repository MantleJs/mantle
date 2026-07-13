import { BadRequest } from "./errors.js";

/** Maximum bracket nesting depth accepted in a query key (abuse guard). */
const MAX_DEPTH = 5;

/**
 * Parse flat query-string keys with bracket notation into the nested object shape
 * Express produces via `qs`, so every HTTP transport yields identical `params.query`:
 *
 *   { "age[$gt]": "21" }                    → { age: { $gt: "21" } }
 *   { "$or[0][role]": "admin" }             → { $or: [{ role: "admin" }] }
 *   { "tags[]": ["a", "b"] }                → { tags: ["a", "b"] }
 *   { tags: ["a", "b"] } (repeated key)     → { tags: ["a", "b"] }
 *
 * Values stay strings — type coercion is a schema concern, not a transport concern.
 * Keys nested deeper than {@link MAX_DEPTH} throw `BadRequest`.
 */
export function parseQueryString(flat: Record<string, string | string[]>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [rawKey, rawValue] of Object.entries(flat)) {
    const segments = splitKey(rawKey);
    if (segments.length > MAX_DEPTH) {
      throw new BadRequest(`Query parameter "${rawKey}" exceeds the maximum nesting depth of ${MAX_DEPTH}`);
    }
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    for (const value of values) {
      assign(result, segments, value);
    }
  }
  return result;
}

/** Split "a[$gt]" into ["a", "$gt"], "$or[0][role]" into ["$or", "0", "role"], "plain" into ["plain"]. */
function splitKey(key: string): string[] {
  const match = key.match(/^([^[\]]+)((?:\[[^[\]]*\])*)$/);
  if (!match) return [key];
  const segments = [match[1] as string];
  const brackets = match[2] ?? "";
  for (const m of brackets.matchAll(/\[([^[\]]*)\]/g)) {
    segments.push(m[1] as string);
  }
  return segments;
}

function nextContainer(segment: string): unknown[] | Record<string, unknown> {
  return segment === "" || /^\d+$/.test(segment) ? [] : {};
}

function assign(root: Record<string, unknown>, segments: string[], value: string): void {
  let container: unknown[] | Record<string, unknown> = root;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i] as string;
    const isLast = i === segments.length - 1;

    if (Array.isArray(container)) {
      const index = seg === "" ? container.length : Number(seg);
      if (isLast) {
        container[index] = value;
      } else {
        if (container[index] === undefined || typeof container[index] !== "object") {
          container[index] = nextContainer(segments[i + 1] as string);
        }
        container = container[index] as unknown[] | Record<string, unknown>;
      }
    } else {
      if (isLast) {
        const existing = container[seg];
        if (existing === undefined) {
          container[seg] = value;
        } else if (Array.isArray(existing)) {
          existing.push(value);
        } else {
          container[seg] = [existing, value];
        }
      } else {
        if (container[seg] === undefined || typeof container[seg] !== "object" || container[seg] === null) {
          container[seg] = nextContainer(segments[i + 1] as string);
        }
        container = container[seg] as unknown[] | Record<string, unknown>;
      }
    }
  }
}
