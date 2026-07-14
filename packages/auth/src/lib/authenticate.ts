import type { HookContext, HookFunction } from "@mantlejs/mantle";
import { NotAuthenticated, NotFound } from "@mantlejs/mantle";
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
  if (strategy === "jwt") {
    return (context: HookContext) => authenticateJwt(context, options);
  }

  return async (context: HookContext): Promise<HookContext> => {
    if (!context.params.provider) return context;
    const engine = context.app.get<AuthEngine>("auth");
    if (!engine) {
      throw new NotAuthenticated("Auth plugin is not configured");
    }
    const result = await engine.authenticate(strategy, context.data ?? {}, context.params);
    context.params.user = result;
    return context;
  };
}

async function authenticateJwt(context: HookContext, options: AuthenticateOptions): Promise<HookContext> {
  // Internal calls (no provider) bypass JWT verification
  if (!context.params.provider) return context;

  const engine = context.app.get<AuthEngine>("auth");
  if (!engine) {
    throw new NotAuthenticated("Auth plugin is not configured");
  }

  const authorization =
    (context.params.headers?.["authorization"] as string | undefined) ??
    (context.params.headers?.["Authorization"] as string | undefined);

  if (!authorization) {
    throw new NotAuthenticated("No authorization header provided");
  }

  const spaceIndex = authorization.indexOf(" ");
  const scheme = spaceIndex >= 0 ? authorization.slice(0, spaceIndex) : authorization;
  const token = spaceIndex >= 0 ? authorization.slice(spaceIndex + 1) : "";

  if (scheme.toLowerCase() !== "bearer" || !token) {
    throw new NotAuthenticated("Invalid authorization header format. Expected: Bearer <token>");
  }

  let payload: JwtPayload;
  try {
    payload = engine.verifyJwt(token);
  } catch {
    throw new NotAuthenticated("Invalid or expired token");
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
