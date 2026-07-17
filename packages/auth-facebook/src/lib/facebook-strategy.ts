import type { MantlePlugin } from "@mantlejs/mantle";
import { GeneralError } from "@mantlejs/mantle";
import { Facebook } from "arctic";
// eslint-disable-next-line @nx/enforce-module-boundaries -- spec uses await import() for vi.mock which makes Nx treat auth-oauth as lazy-loaded
import { createOAuthPlugin } from "@mantlejs/auth-oauth";
import type {
  OAuthPluginConfig,
  OAuthProvider,
  AuthUrlParams,
  CodeExchangeParams,
  OAuthProfile,
} from "@mantlejs/auth-oauth";

const FACEBOOK_PROFILE_URL = "https://graph.facebook.com/me";

export type FacebookStrategyConfig = OAuthPluginConfig;

// Authorization URL and token exchange are delegated to Arctic (ADR-002), which
// pins the Graph API version; only profile normalization stays hand-written.
const facebookProvider: OAuthProvider = {
  usePkce: false,
  defaultScope: ["email", "public_profile"],

  buildAuthUrl({ clientId, redirectUri, scope, state }: AuthUrlParams): string {
    // The client secret is not used for URL construction.
    const facebook = new Facebook(clientId, "", redirectUri);
    return facebook.createAuthorizationURL(state, scope).toString();
  },

  async exchangeCode({ code, clientId, clientSecret, redirectUri }: CodeExchangeParams): Promise<string> {
    const facebook = new Facebook(clientId, clientSecret, redirectUri);
    try {
      const tokens = await facebook.validateAuthorizationCode(code);
      return tokens.accessToken();
    } catch {
      throw new GeneralError("Failed to exchange authorization code with Facebook");
    }
  },

  async fetchProfile(accessToken: string): Promise<OAuthProfile> {
    const params = new URLSearchParams({
      fields: "id,name,email",
      access_token: accessToken,
    });

    const response = await fetch(`${FACEBOOK_PROFILE_URL}?${params.toString()}`);

    if (!response.ok) {
      throw new GeneralError("Failed to fetch Facebook user profile");
    }

    const data = (await response.json()) as Record<string, unknown>;
    const id = data["id"];
    if (typeof id !== "string") {
      throw new GeneralError("Missing id in Facebook profile response");
    }

    return {
      id,
      email: typeof data["email"] === "string" ? data["email"] : undefined,
      name: typeof data["name"] === "string" ? data["name"] : undefined,
    };
  },
};

export function facebookStrategy(config: FacebookStrategyConfig): MantlePlugin {
  return createOAuthPlugin("facebook", facebookProvider, {
    ...config,
    scope: config.scope ?? facebookProvider.defaultScope,
    entityIdField: config.entityIdField ?? "facebookId",
  });
}
