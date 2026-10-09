import type { CapabilityScope, MantleApplication, ServiceParams } from "@mantlejs/mantle";

/**
 * The slice of `@mantlejs/auth`'s `AuthEngine` (registered under `app.get("auth")`) used here,
 * duck-typed — the same no-dependency convention `@mantlejs/mcp` uses for session auth.
 */
interface AgentTokenVerifier {
  verifyJwt(token: string): Record<string, unknown>;
  isAgentTokenValid?(id: string): Promise<boolean>;
}

function bearerToken(headers: ServiceParams["headers"]): string | undefined {
  const authorization = headers?.["authorization"] ?? headers?.["Authorization"];
  if (!authorization) return undefined;
  const spaceIndex = authorization.indexOf(" ");
  if (spaceIndex < 0 || authorization.slice(0, spaceIndex).toLowerCase() !== "bearer") return undefined;
  return authorization.slice(spaceIndex + 1) || undefined;
}

/**
 * The capability scope of the session's agent token, when the session authenticated with one —
 * used only to narrow which methods the typed API *shows*. Session params don't carry
 * `HookContext.agent` (it's set inside the hook pipeline by `authorizeAgent()`), so the token is
 * read from `params.headers.authorization` and verified with the app's auth engine, exactly as
 * `authorizeAgent()` does. Any failure — no engine, no/invalid/revoked token, not an agent token —
 * returns `undefined` (show the full exposed API); enforcement stays with the hooks.
 */
export async function resolveAgentScope(
  app: MantleApplication,
  params: ServiceParams,
): Promise<CapabilityScope | undefined> {
  const engine = app.get<Partial<AgentTokenVerifier> | undefined>("auth");
  const token = bearerToken(params.headers);
  if (token === undefined || typeof engine?.verifyJwt !== "function") return undefined;

  let payload: Record<string, unknown>;
  try {
    payload = engine.verifyJwt(token);
  } catch {
    return undefined;
  }
  const scope = payload["scope"];
  const id = payload["sub"];
  if (payload["type"] !== "agent" || typeof id !== "string" || scope === null || typeof scope !== "object") {
    return undefined;
  }
  if (typeof engine.isAgentTokenValid === "function" && !(await engine.isAgentTokenValid(id))) return undefined;
  return scope as CapabilityScope;
}
