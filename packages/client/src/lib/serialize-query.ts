/**
 * Serialize a nested query object into the bracket-notation query string that
 * every Mantle HTTP transport parses back into the identical object via
 * `parseQueryString` in `@mantlejs/mantle` (Express's `qs` produces the same
 * shape):
 *
 *   { age: { $gt: 21 } }                  → "age[$gt]=21"
 *   { $or: [{ role: "admin" }] }          → "$or[0][role]=admin"
 *   { tags: ["a", "b"] }                  → "tags[0]=a&tags[1]=b"
 *
 * Values arrive server-side as strings — type coercion is the server schema's
 * concern. `undefined` values are dropped; `null` serializes as an empty
 * string (matching `qs`), so `IS NULL` queries need server-side coercion.
 */
export function serializeQuery(query: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    append(params, key, value);
  }
  return params.toString();
}

function append(params: URLSearchParams, key: string, value: unknown): void {
  if (value === undefined) return;
  if (value === null) {
    params.append(key, "");
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => append(params, `${key}[${index}]`, item));
    return;
  }
  if (typeof value === "object") {
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
      append(params, `${key}[${childKey}]`, childValue);
    }
    return;
  }
  params.append(key, String(value));
}
