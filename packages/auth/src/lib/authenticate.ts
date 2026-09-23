import type { HookContext, HookFunction } from "@mantlejs/mantle";
import { NotAuthenticated, NotFound } from "@mantlejs/mantle";
import { extractBearerToken } from "./bearer-token.js";
import type { AuthEngine, JwtPayload } from "./types.js";

export interface AuthenticateOptions {
  /**
   * Service path to resolve the authenticated user record from. When set, `params.user`
   * becomes `app.service(entity).get(payload.sub)` (internal call, no provider) and the raw
   * JWT payload moves to `params.authPayload`. When omitted, `params.user` is the raw payload.
   */
  entity?: string;
}

export function authenticate(strategy: string, options: AuthenticateOptions = {}): HookFunction {
  const hook: HookFunction =
    strategy === "jwt"
      ? (context: HookContext) => authenticateJwt(context, options)
      : async (context: HookContext): Promise<HookContext> => {
          if (!context.params.provider) return context;
          const engine = context.app.get<AuthEngine>("auth");
          if (!engine) {
            throw new NotAuthenticated("Auth plugin is not configured");
          }
          const result = await engine.authenticate(strategy, context.data ?? {}, context.params);
          context.params.user = result;
          return context;
        };

  // Marker consumed by ServiceHandle.describe() to report `authRequired` without
  // @mantlejs/mantle depending on this package.
  return Object.assign(hook, { authStrategy: strategy });
}

async function authenticateJwt(context: HookContext, options: AuthenticateOptions): Promise<HookContext> {
  // Internal calls (no provider) bypass JWT verification
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

  if (payload["type"] === "agent") {
    throw new NotAuthenticated("Agent tokens must be authorized via authorizeAgent(), not authenticate('jwt')");
  }

  if (options.entity !== undefined) {
    if (payload.sub === undefined) {
      throw new NotAuthenticated("Token has no subject to resolve a user from");
    }
    let user: unknown;
    try {
      // Internal call — no provider, so service hooks treat it as trusted
      user = await context.app.service(options.entity).get(String(payload.sub));
    } catch (err) {
      if (err instanceof NotFound) {
        throw new NotAuthenticated("User for this token no longer exists");
      }
      throw err;
    }
    context.params.user = user as Record<string, unknown>;
    context.params.authPayload = payload;
    return context;
  }

  context.params.user = payload;
  return context;
}
