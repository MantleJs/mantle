import type { MantlePlugin } from "@mantlejs/core";
import { GeneralError } from "@mantlejs/core";
import { createOAuthPlugin } from "@mantlejs/auth-oauth";
import type { OAuthPluginConfig, OAuthProvider, AuthUrlParams, CodeExchangeParams, OAuthProfile } from "@mantlejs/auth-oauth";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

export type GoogleStrategyConfig = OAuthPluginConfig;

const googleProvider: OAuthProvider = {
  usePkce: true,
  defaultScope: ["openid", "profile", "email"],

  buildAuthUrl({ clientId, redirectUri, scope, state, codeChallenge }: AuthUrlParams): string {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: scope.join(" "),
      state,
      code_challenge: codeChallenge ?? "",
      code_challenge_method: "S256",
    });
    return `${GOOGLE_AUTH_URL}?${params.toString()}`;
  },

  async exchangeCode({ code, clientId, clientSecret, redirectUri, codeVerifier }: CodeExchangeParams): Promise<string> {
    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        code_verifier: codeVerifier ?? "",
      }).toString(),
    });

    if (!response.ok) {
      throw new GeneralError("Failed to exchange authorization code with Google");
    }

    const data = (await response.json()) as Record<string, unknown>;
    const accessToken = data["access_token"];
    if (typeof accessToken !== "string") {
      throw new GeneralError("No access token in Google token response");
    }
    return accessToken;
  },

  async fetchProfile(accessToken: string): Promise<OAuthProfile> {
    const response = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      throw new GeneralError("Failed to fetch Google user profile");
    }

    const data = (await response.json()) as Record<string, unknown>;
    const id = data["sub"];
    if (typeof id !== "string") {
      throw new GeneralError("Missing sub claim in Google userinfo response");
    }

    return {
      id,
      email: typeof data["email"] === "string" ? data["email"] : undefined,
      name: typeof data["name"] === "string" ? data["name"] : undefined,
    };
  },
};

export function googleStrategy(config: GoogleStrategyConfig): MantlePlugin {
  return createOAuthPlugin("google", googleProvider, {
    ...config,
    scope: config.scope ?? googleProvider.defaultScope,
    entityIdField: config.entityIdField ?? "googleId",
  });
}
