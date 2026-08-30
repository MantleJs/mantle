import type { HookContext, HookFunction } from "@mantlejs/mantle";

/** Stamps the authenticated user onto `data[field]` — never trust a client-supplied author/owner id. */
export function attachActor(field: string): HookFunction {
  return (context: HookContext) => {
    const user = context.params.user as { id?: unknown } | undefined;
    if (user?.id !== undefined && context.data) {
      (context.data as Record<string, unknown>)[field] = user.id;
    }
    return context;
  };
}
