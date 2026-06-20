import type { ServiceParams } from "@mantlejs/core";

export interface AuthConfig {
  secret: string;
  algorithms?: string[];
  expiresIn?: string | number;
  issuer?: string;
  audience?: string | string[];
}

export interface JwtPayload {
  sub?: string;
  iat?: number;
  exp?: number;
  iss?: string;
  aud?: string | string[];
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
  createJwt(payload: JwtPayload): string;
  verifyJwt(token: string): JwtPayload;
  registerStrategy(strategy: AuthStrategy): void;
  authenticate(strategyName: string, data: Record<string, unknown>, params: ServiceParams): Promise<AuthResult>;
}
