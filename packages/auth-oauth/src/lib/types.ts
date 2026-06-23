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
  codeChallenge?: string;
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
}
