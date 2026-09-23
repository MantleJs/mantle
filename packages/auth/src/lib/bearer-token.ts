import type { ServiceParams } from "@mantlejs/mantle";

/** Extracts the token from a `Bearer <token>` `Authorization` header, or `undefined` if absent/malformed. */
export function extractBearerToken(headers: ServiceParams["headers"]): string | undefined {
  const authorization = headers?.["authorization"] ?? headers?.["Authorization"];
  if (!authorization) return undefined;

  const spaceIndex = authorization.indexOf(" ");
  const scheme = spaceIndex >= 0 ? authorization.slice(0, spaceIndex) : authorization;
  const token = spaceIndex >= 0 ? authorization.slice(spaceIndex + 1) : "";

  return scheme.toLowerCase() === "bearer" && token ? token : undefined;
}
