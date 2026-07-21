import type { MantlePlugin } from "@mantlejs/mantle";
import { GeneralError } from "@mantlejs/mantle";
import { LinkedIn } from "arctic";
// eslint-disable-next-line @nx/enforce-module-boundaries -- spec uses await import() for vi.mock which makes Nx treat auth-oauth as lazy-loaded
import { createOAuthPlugin } from "@mantlejs/auth-oauth";
import type {
  OAuthPluginConfig,
  OAuthProvider,
  AuthUrlParams,
  CodeExchangeParams,
  OAuthProfile,
} from "@mantlejs/auth-oauth";

const LINKEDIN_USERINFO_URL = "https://api.linkedin.com/v2/userinfo";

export type LinkedInStrategyConfig = OAuthPluginConfig;

// Authorization URL and token exchange are delegated to Arctic (ADR-002); only
// profile normalization is LinkedIn-specific enough to stay hand-written. Uses
// LinkedIn's OpenID Connect flow ("Sign In with LinkedIn using OpenID Connect")
// — not the legacy v2 profile API.
const linkedinProvider: OAuthProvider = {
  usePkce: false,
  defaultScope: ["openid", "profile", "email"],

  buildAuthUrl({ clientId, redirectUri, scope, state }: AuthUrlParams): string {
    // The client secret is not used for URL construction.
    const linkedin = new LinkedIn(clientId, "", redirectUri);
    return linkedin.createAuthorizationURL(state, scope).toString();
  },

  async exchangeCode({ code, clientId, clientSecret, redirectUri }: CodeExchangeParams): Promise<string> {
    const linkedin = new LinkedIn(clientId, clientSecret, redirectUri);
    try {
      const tokens = await linkedin.validateAuthorizationCode(code);
      return tokens.accessToken();
    } catch {
      throw new GeneralError("Failed to exchange authorization code with LinkedIn");
    }
  },

  async fetchProfile(accessToken: string): Promise<OAuthProfile> {
    const response = await fetch(LINKEDIN_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      throw new GeneralError("Failed to fetch LinkedIn user profile");
    }

    const data = (await response.json()) as Record<string, unknown>;
    const id = data["sub"];
    if (typeof id !== "string") {
      throw new GeneralError("Missing sub claim in LinkedIn userinfo response");
    }

    return {
      id,
      email: typeof data["email"] === "string" ? data["email"] : undefined,
      name: typeof data["name"] === "string" ? data["name"] : undefined,
    };
  },
};

export function linkedinStrategy(config: LinkedInStrategyConfig): MantlePlugin {
  return createOAuthPlugin("linkedin", linkedinProvider, {
    ...config,
    scope: config.scope ?? linkedinProvider.defaultScope,
    entityIdField: config.entityIdField ?? "linkedinId",
  });
}
