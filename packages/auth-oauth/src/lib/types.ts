import type { OAuthStateStore } from "./state-store.js";

export interface OAuthProfile {
  id: string;
  email?: string;
  name?: string;
}

export interface AuthUrlParams {
  clientId: string;
  redirectUri: string;
  scope: string[];
  state: string;
  /**
   * PKCE code verifier, present when the provider declares `usePkce`. The provider derives
   * the S256 code challenge from it (Arctic does this internally in `createAuthorizationURL`).
   */
  codeVerifier?: string;
}

export interface CodeExchangeParams {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  codeVerifier?: string;
}

export interface OAuthProvider {
  usePkce: boolean;
  defaultScope: string[];
  buildAuthUrl(params: AuthUrlParams): string;
  exchangeCode(params: CodeExchangeParams): Promise<string>;
  fetchProfile(accessToken: string): Promise<OAuthProfile>;
}

export interface OAuthPluginConfig {
  clientId: string;
  clientSecret: string;
  /** Path registered as the OAuth callback route. Default: `/auth/{providerKey}/callback` */
  callbackUrl?: string;
  scope?: string[];
  /** Service used to find or create users. Default: `'users'` */
  entity?: string;
  /** Field matched against the provider's user ID. Default: `'{providerKey}Id'` */
  entityIdField?: string;
  /**
   * Store for pending OAuth state (CSRF token + PKCE verifier). Defaults to an in-process
   * in-memory store — multi-instance deployments (e.g. Cloud Run) must inject a shared
   * implementation (Redis or similar) so the callback can land on any instance.
   */
  stateStore?: OAuthStateStore;
}
