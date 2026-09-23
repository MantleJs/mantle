/**
 * Grant map for one capability-scoped principal: methods allowed per service path, or `true` for
 * every method on that path (a path-level wildcard). A path absent from the map — or present with
 * a method not listed — is denied. This is the same shape `@mantlejs/mcp`'s `services` expose map
 * already uses; `@mantlejs/auth`'s agent tokens (`authorizeAgent()`) reuse it too, so there is one
 * deny-by-default "is this path+method allowed" implementation in the framework, not two that can
 * silently drift apart.
 */
export type CapabilityScope = Record<string, string[] | true>;

/** Deny-by-default match: `path` must be present in `scope`, and `method` must be within its grant. */
export function matchesCapabilityScope(scope: CapabilityScope, path: string, method: string): boolean {
  const grant = scope[path];
  if (grant === undefined) return false;
  return grant === true || grant.includes(method);
}
