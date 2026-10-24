import type { HookContext } from "@mantlejs/mantle";

/**
 * Picks who a call counts against. Returning `undefined` skips the limit for that call (e.g. `byUser()` on an
 * anonymous request). Keys are namespaced by kind (`user:…`, `agent:…`), so different kinds never share a counter.
 */
export type RateLimitKey = (context: HookContext) => string | undefined;

function idOf(value: unknown): string | undefined {
  return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
}

/** The authenticated user: the resolved record's `id`, or the JWT payload's `sub`. */
export function byUser(): RateLimitKey {
  return (context) => {
    const user = context.params.user;
    const id = idOf(user?.["id"]) ?? idOf(user?.["sub"]);
    return id === undefined ? undefined : `user:${id}`;
  };
}

/** The agent calling with a capability-scoped token (`context.agent`, set by `authorizeAgent()`). */
export function byAgent(): RateLimitKey {
  return (context) => (context.agent ? `agent:${context.agent.id}` : undefined);
}

/** The client address, `params.ip` — set by the HTTP transports (mind their `trustProxy` option). */
export function byIp(): RateLimitKey {
  return (context) => (context.params.ip ? `ip:${context.params.ip}` : undefined);
}

/** The tenant, `params.tenant.id` (set by `@mantlejs/tenancy`'s `resolveTenant()`): one budget per customer. */
export function byTenant(): RateLimitKey {
  return (context) => {
    const tenant = context.params["tenant"] as { id?: unknown } | undefined;
    const id = idOf(tenant?.id);
    return id === undefined ? undefined : `tenant:${id}`;
  };
}

/**
 * The most specific identity available: the agent, else the user, else the IP. An agent gets its own budget, separate
 * from the user who delegated to it, so a runaway agent can't exhaust its user's limit.
 */
export function byPrincipal(): RateLimitKey {
  const keys = [byAgent(), byUser(), byIp()];
  return (context) => {
    for (const key of keys) {
      const value = key(context);
      if (value !== undefined) return value;
    }
    return undefined;
  };
}
