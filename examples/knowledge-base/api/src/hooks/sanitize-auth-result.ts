import type { HookContext, HookFunction } from "@mantlejs/mantle";
import type { User } from "../entities/user.js";

/**
 * `sanitizeUser()` only strips top-level result fields — the built-in "authentication"
 * service nests the user record under `result.user`, so the password hash needs its own hook.
 */
export function sanitizeAuthResult(): HookFunction {
  return (context: HookContext) => {
    const result = context.result as { user?: Partial<User> } | undefined;
    if (context.params.provider && result?.user) {
      // JSON.stringify drops undefined-valued keys, so this omits password on the wire.
      result.user = { ...result.user, password: undefined };
    }
    return context;
  };
}
