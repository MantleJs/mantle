import { hash } from "@node-rs/argon2";
import type { HookContext, HookFunction } from "@mantlejs/core";

export function hashPassword(field = "password"): HookFunction {
  return async (context: HookContext): Promise<HookContext> => {
    const data = context.data as Record<string, unknown> | undefined;
    if (!data || typeof data[field] !== "string") {
      return context;
    }
    data[field] = await hash(data[field] as string);
    return context;
  };
}
