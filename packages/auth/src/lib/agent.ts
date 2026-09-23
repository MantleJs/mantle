import type { CapabilityScope, HookContext, HookFunction } from "@mantlejs/mantle";
import { Forbidden, NotAuthenticated, matchesCapabilityScope } from "@mantlejs/mantle";
import { extractBearerToken } from "./bearer-token.js";
import type { AuthEngine, JwtPayload } from "./types.js";

/**
 * A `before` hook authorizing an agent-token call against the token's capability scope.
 * Deny-by-default (reuses `@mantlejs/mantle`'s `matchesCapabilityScope`, the same matcher
 * `@mantlejs/mcp`'s expose map is built on) — a call whose `path`+`method` isn't covered by the
 * token's scope throws `Forbidden`.
 *
 * Opt-in per route: this is the *only* hook that accepts an agent token. `authenticate("jwt")`
 * rejects a `type: "agent"` payload outright, so a route with no `authorizeAgent()` hook attached
 * can never be reached with an agent token, no matter what scope it carries.
 *
 * Skips (passes through) for internal calls — `params.provider` undefined — matching
 * `authenticate("jwt")`'s own convention.
 */
export function authorizeAgent(): HookFunction {
  return async (context: HookContext): Promise<HookContext> => {
    if (!context.params.provider) return context;

    const engine = context.app.get<AuthEngine>("auth");
    if (!engine) {
      throw new NotAuthenticated("Auth plugin is not configured");
    }

    const token = extractBearerToken(context.params.headers);
    if (!token) {
      throw new NotAuthenticated("No valid Bearer token provided. Expected: Authorization: Bearer <token>");
    }

    let payload: JwtPayload;
    try {
      payload = engine.verifyJwt(token);
    } catch {
      throw new NotAuthenticated("Invalid or expired token");
    }

    if (payload["type"] !== "agent" || typeof payload.sub !== "string") {
      throw new NotAuthenticated("Not an agent token");
    }

    const scope = payload["scope"] as CapabilityScope | undefined;
    const delegatingUserId = payload["delegatingUserId"];
    if (!scope || typeof scope !== "object" || typeof delegatingUserId !== "string") {
      throw new NotAuthenticated("Malformed agent token");
    }

    if (!(await engine.isAgentTokenValid(payload.sub))) {
      throw new NotAuthenticated("Agent token has been revoked or is unknown");
    }

    if (!matchesCapabilityScope(scope, context.path, context.method)) {
      throw new Forbidden(`Agent '${payload.sub}' is not authorized to call '${context.method}' on '${context.path}'`);
    }

    context.agent = { id: payload.sub, scope, delegatingUserId };
    return context;
  };
}
