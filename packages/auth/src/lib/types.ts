import type { AgentContext, CapabilityScope, ServiceParams } from "@mantlejs/mantle";

export interface AuthConfig {
  secret: string;
  algorithms?: string[];
  expiresIn?: string | number;
  issuer?: string;
  audience?: string | string[];
  /** Refresh-token TTL. @default "30d" */
  refreshExpiresIn?: string | number;
  /**
   * Storage for outstanding refresh-token ids. Defaults to an in-memory store;
   * multi-instance deployments must inject a shared implementation (see D-6).
   */
  refreshTokenStore?: RefreshTokenStore;
  /**
   * Storage for outstanding agent-token ids, enabling `revokeAgentToken()` to revoke a token
   * before its JWT expiry. Defaults to an in-memory store; multi-instance deployments must inject
   * a shared implementation (see D-6, same rationale as `refreshTokenStore`).
   */
  agentTokenStore?: AgentTokenStore;
}

/**
 * Tracks issued refresh tokens by `jti` so rotation and revocation work.
 * Methods are sync-or-async so a Redis-backed store can be injected without
 * an interface change.
 */
export interface RefreshTokenStore {
  /** Record an issued refresh token. `expiresAt` is the JWT `exp` in epoch seconds. */
  add(jti: string, sub: string, expiresAt: number): void | Promise<void>;
  /**
   * Atomically remove `jti`, returning whether it was present. A `false` return
   * for a token whose JWT still verifies means the token was already used —
   * treat it as theft and revoke the family.
   */
  consume(jti: string): boolean | Promise<boolean>;
  /** Revoke every outstanding refresh token for a subject. */
  revokeAll(sub: string): void | Promise<void>;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/**
 * Tracks issued agent-token ids so they can be revoked before their JWT's natural expiry — the
 * same problem `RefreshTokenStore` solves for refresh tokens, applied to short-lived,
 * capability-scoped agent tokens instead. Methods are sync-or-async so a Redis-backed store can be
 * injected without an interface change.
 */
export interface AgentTokenStore {
  /** Record an issued agent token. `expiresAt` is the JWT `exp` in epoch seconds. */
  add(id: string, expiresAt: number): void | Promise<void>;
  /** True unless `id` was never issued on this store, or has since been revoked/reaped. */
  isValid(id: string): boolean | Promise<boolean>;
  /** Revoke one agent token immediately, independent of its JWT expiry. */
  revoke(id: string): void | Promise<void>;
}

/**
 * The decoded shape of an agent token's payload, and of `HookContext.agent` once
 * `authorizeAgent()` accepts it. `id` is the agent's own id (the token's `sub`/store key) —
 * distinct from `delegatingUserId`, the user who minted the token.
 */
export type AgentPrincipal = AgentContext;

export interface AgentTokenOptions {
  /** Agent-token lifetime. Strings use ms format (`"15m"`, `"1h"`); numbers are seconds. @default "15m" */
  expiresIn?: string | number;
}

export interface IssuedAgentToken {
  accessToken: string;
  /** The agent's id — pass to `revokeAgentToken()` to revoke this token early. */
  id: string;
  /** Epoch seconds the token expires at. */
  expiresAt: number;
}

export interface JwtPayload {
  sub?: string;
  iat?: number;
  exp?: number;
  iss?: string;
  aud?: string | string[];
  jti?: string;
  [key: string]: unknown;
}

export interface AuthResult {
  accessToken: string;
  [key: string]: unknown;
}

export interface AuthStrategy {
  readonly name: string;
  authenticate(data: Record<string, unknown>, params: ServiceParams): Promise<AuthResult>;
}

export interface AuthEngine {
  readonly config: AuthConfig;
  createJwt(payload: JwtPayload, options?: { expiresIn?: string | number }): string;
  verifyJwt(token: string): JwtPayload;
  /**
   * Issue an access + refresh token pair for a subject. The refresh token carries
   * `{ sub, type: "refresh", jti }`, is signed with `refreshExpiresIn`, and its
   * `jti` is recorded in the RefreshTokenStore before the pair is returned.
   * All strategies must issue refresh tokens through this helper so `jti`
   * bookkeeping stays uniform.
   */
  createTokenPair(sub: string, accessExtra?: Record<string, unknown>): Promise<TokenPair>;
  registerStrategy(strategy: AuthStrategy): void;
  authenticate(strategyName: string, data: Record<string, unknown>, params: ServiceParams): Promise<AuthResult>;
  /**
   * Mint a short-lived, capability-scoped agent token delegated from `delegatingUserId`. The
   * token is a JWT carrying `{ sub: <agent id>, type: "agent", scope, delegatingUserId }` — only
   * `authorizeAgent()` accepts it, never `authenticate("jwt")`. Recorded in the `AgentTokenStore`
   * so it can be revoked before its natural expiry via `revokeAgentToken`.
   */
  issueAgentToken(
    scope: CapabilityScope,
    delegatingUserId: string,
    options?: AgentTokenOptions,
  ): Promise<IssuedAgentToken>;
  /** Revoke one agent token immediately, independent of its JWT expiry. */
  revokeAgentToken(id: string): Promise<void>;
  /** True unless the agent token id was revoked, or was never issued on this engine's store. */
  isAgentTokenValid(id: string): Promise<boolean>;
}
