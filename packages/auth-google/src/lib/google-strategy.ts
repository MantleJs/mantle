import type { MantlePlugin } from "@mantlejs/mantle";
import { GeneralError } from "@mantlejs/mantle";
import { Google } from "arctic";
// eslint-disable-next-line @nx/enforce-module-boundaries -- spec uses await import() for vi.mock which makes Nx treat auth-oauth as lazy-loaded
import { createOAuthPlugin } from "@mantlejs/auth-oauth";
import type { OAuthPluginConfig, OAuthProvider, AuthUrlParams, CodeExchangeParams, OAuthProfile } from "@mantlejs/auth-oauth";

const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

export type GoogleStrategyConfig = OAuthPluginConfig;

// Authorization URL and token exchange are delegated to Arctic (ADR-002); only
// profile normalization is Google-specific enough to stay hand-written.
const googleProvider: OAuthProvider = {
  usePkce: true,
  defaultScope: ["openid", "profile", "email"],

  buildAuthUrl({ clientId, redirectUri, scope, state, codeVerifier }: AuthUrlParams): string {
    // The client secret is not used for URL construction.
    const google = new Google(clientId, "", redirectUri);
    return google.createAuthorizationURL(state, codeVerifier ?? "", scope).toString();
  },

  async exchangeCode({ code, clientId, clientSecret, redirectUri, codeVerifier }: CodeExchangeParams): Promise<string> {
    const google = new Google(clientId, clientSecret, redirectUri);
    try {
      const tokens = await google.validateAuthorizationCode(code, codeVerifier ?? "");
      return tokens.accessToken();
    } catch {
      throw new GeneralError("Failed to exchange authorization code with Google");
    }
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
