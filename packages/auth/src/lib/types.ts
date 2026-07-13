import type { ServiceParams } from "@mantlejs/mantle";

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
}
