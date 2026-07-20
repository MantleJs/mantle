import type { MantlePlugin } from "@mantlejs/mantle";
import { GeneralError } from "@mantlejs/mantle";
import { MicrosoftEntraId } from "arctic";
// eslint-disable-next-line @nx/enforce-module-boundaries -- spec uses await import() for vi.mock which makes Nx treat auth-oauth as lazy-loaded
import { createOAuthPlugin } from "@mantlejs/auth-oauth";
import type {
  OAuthPluginConfig,
  OAuthProvider,
  AuthUrlParams,
  CodeExchangeParams,
  OAuthProfile,
} from "@mantlejs/auth-oauth";

const MICROSOFT_USERINFO_URL = "https://graph.microsoft.com/oidc/userinfo";

export interface MicrosoftStrategyConfig extends OAuthPluginConfig {
  /** Entra tenant: "common" (default), "organizations", "consumers", or a tenant ID. */
  tenant?: string;
}

// Authorization URL and token exchange are delegated to Arctic (ADR-002); only
// profile normalization is Microsoft-specific enough to stay hand-written. The
// tenant lives in the provider closure — the Arctic client is still built per
// call because redirectUri varies, same as Google's.
function createMicrosoftProvider(tenant: string): OAuthProvider {
  return {
    usePkce: true,
    defaultScope: ["openid", "profile", "email"],

    buildAuthUrl({ clientId, redirectUri, scope, state, codeVerifier }: AuthUrlParams): string {
      // The client secret is not used for URL construction.
      const microsoft = new MicrosoftEntraId(tenant, clientId, "", redirectUri);
      return microsoft.createAuthorizationURL(state, codeVerifier ?? "", scope).toString();
    },

    async exchangeCode({
      code,
      clientId,
      clientSecret,
      redirectUri,
      codeVerifier,
    }: CodeExchangeParams): Promise<string> {
      const microsoft = new MicrosoftEntraId(tenant, clientId, clientSecret, redirectUri);
      try {
        const tokens = await microsoft.validateAuthorizationCode(code, codeVerifier ?? "");
        return tokens.accessToken();
      } catch {
        throw new GeneralError("Failed to exchange authorization code with Microsoft");
      }
    },

    async fetchProfile(accessToken: string): Promise<OAuthProfile> {
      const response = await fetch(MICROSOFT_USERINFO_URL, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!response.ok) {
        throw new GeneralError("Failed to fetch Microsoft user profile");
      }

      const data = (await response.json()) as Record<string, unknown>;
      const id = data["sub"];
      if (typeof id !== "string") {
        throw new GeneralError("Missing sub claim in Microsoft userinfo response");
      }

      return {
        id,
        email: typeof data["email"] === "string" ? data["email"] : undefined,
        name: typeof data["name"] === "string" ? data["name"] : undefined,
      };
    },
  };
}

export function microsoftStrategy(config: MicrosoftStrategyConfig): MantlePlugin {
  const { tenant, ...oauthConfig } = config;
  const provider = createMicrosoftProvider(tenant ?? "common");
  return createOAuthPlugin("microsoft", provider, {
    ...oauthConfig,
    scope: config.scope ?? provider.defaultScope,
    entityIdField: config.entityIdField ?? "microsoftId",
  });
}
