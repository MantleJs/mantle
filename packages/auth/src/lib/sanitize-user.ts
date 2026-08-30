import type { HookContext, HookFunction } from "@mantlejs/mantle";

const DEFAULT_SENSITIVE_FIELDS = ["password", "passwordHash", "password_hash"];

/**
 * Strip sensitive fields from a result before it's serialized back to a client.
 *
 * Gated on `context.params.provider`, the same "no provider = internal/trusted call"
 * convention `authenticate()` uses — an unconditional strip would also scrub results
 * returned from internal calls, breaking `@mantlejs/auth-local`'s credential lookup
 * (it reads the stored password hash off `app.service("users").find(...)` to verify
 * against, and that call shares this same service's `after` hooks).
 */
export function sanitizeUser(fields = DEFAULT_SENSITIVE_FIELDS): HookFunction {
  return (context: HookContext): HookContext => {
    if (context.params?.provider && context.result !== undefined) {
      context.result = stripFields(context.result, fields);
    }
    return context;
  };
}

function stripFields<T>(value: T, fields: string[]): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripFields(item, fields)) as unknown as T;
  }
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (Array.isArray(obj["data"]) && "total" in obj) {
      return { ...obj, data: (obj["data"] as unknown[]).map((item) => stripFields(item, fields)) } as T;
    }
    return Object.fromEntries(Object.entries(obj).filter(([k]) => !fields.includes(k))) as T;
  }
  return value;
}
