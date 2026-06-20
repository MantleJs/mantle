import type { HookContext, HookFunction } from "@mantlejs/core";

const DEFAULT_SENSITIVE_FIELDS = ["password", "passwordHash", "password_hash"];

export function sanitizeUser(fields = DEFAULT_SENSITIVE_FIELDS): HookFunction {
  return (context: HookContext): HookContext => {
    if (context.result !== undefined) {
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
