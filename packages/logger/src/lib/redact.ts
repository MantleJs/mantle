/**
 * Default sensitive-field paths redacted by `createLogger` (pino-level) and by
 * `logRequest`/`logError` (own-code walk, for adapters that aren't pino).
 */
export const SENSITIVE_PATHS = [
  "password",
  "*.password",
  "*.accessToken",
  "*.refreshToken",
  "*.authorization",
  "*.cookie",
];

const REDACTED = "[Redacted]";

function walk(value: unknown, topKeys: Set<string>, anyDepthKeys: Set<string>, depth: number): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => walk(item, topKeys, anyDepthKeys, depth + 1));

  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if ((depth === 0 && topKeys.has(key)) || anyDepthKeys.has(key)) {
      result[key] = REDACTED;
    } else {
      result[key] = walk(val, topKeys, anyDepthKeys, depth + 1);
    }
  }
  return result;
}

/**
 * Deep-clones `value`, replacing any field matched by `paths` with `"[Redacted]"`.
 * Path syntax is a small subset of pino's `redact.paths`: a bare key (`"password"`)
 * matches only at the top level; a `"*.key"` entry matches `key` at any depth.
 */
export function redactPaths(value: unknown, paths: string[] = SENSITIVE_PATHS): unknown {
  if (paths.length === 0) return value;

  const topKeys = new Set<string>();
  const anyDepthKeys = new Set<string>();
  for (const path of paths) {
    if (path.startsWith("*.")) anyDepthKeys.add(path.slice(2));
    else topKeys.add(path);
  }

  return walk(value, topKeys, anyDepthKeys, 0);
}
