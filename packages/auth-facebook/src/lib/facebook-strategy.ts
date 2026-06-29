import type { MantlePlugin } from "@mantlejs/mantle";
import { GeneralError } from "@mantlejs/mantle";
// eslint-disable-next-line @nx/enforce-module-boundaries -- spec uses await import() for vi.mock which makes Nx treat auth-oauth as lazy-loaded
import { createOAuthPlugin } from "@mantlejs/auth-oauth";
import type {
  OAuthPluginConfig,
  OAuthProvider,
  AuthUrlParams,
  CodeExchangeParams,
  OAuthProfile,
} from "@mantlejs/auth-oauth";

const FACEBOOK_API_VERSION = "v18.0";
const FACEBOOK_AUTH_URL = `https://www.facebook.com/${FACEBOOK_API_VERSION}/dialog/oauth`;
const FACEBOOK_TOKEN_URL = `https://graph.facebook.com/${FACEBOOK_API_VERSION}/oauth/access_token`;
const FACEBOOK_PROFILE_URL = "https://graph.facebook.com/me";

export type FacebookStrategyConfig = OAuthPluginConfig;

const facebookProvider: OAuthProvider = {
  usePkce: false,
  defaultScope: ["email", "public_profile"],

  buildAuthUrl({ clientId, redirectUri, scope, state }: AuthUrlParams): string {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: scope.join(","),
      state,
    });
    return `${FACEBOOK_AUTH_URL}?${params.toString()}`;
  },

  async exchangeCode({ code, clientId, clientSecret, redirectUri }: CodeExchangeParams): Promise<string> {
    const params = new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    });

    const response = await fetch(`${FACEBOOK_TOKEN_URL}?${params.toString()}`);

    if (!response.ok) {
      throw new GeneralError("Failed to exchange authorization code with Facebook");
    }

    const data = (await response.json()) as Record<string, unknown>;
    const accessToken = data["access_token"];
    if (typeof accessToken !== "string") {
      throw new GeneralError("No access token in Facebook token response");
    }
    return accessToken;
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
