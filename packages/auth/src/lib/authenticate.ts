import type { HookContext, HookFunction } from "@mantlejs/core";
import { NotAuthenticated } from "@mantlejs/core";
import type { AuthEngine, JwtPayload } from "./types.js";

export function authenticate(strategy: string): HookFunction {
  if (strategy === "jwt") {
    return authenticateJwt;
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

async function authenticateJwt(context: HookContext): Promise<HookContext> {
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

  context.params.user = payload;
  return context;
}
