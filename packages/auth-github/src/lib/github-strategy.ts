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

const GITHUB_AUTH_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_USERINFO_URL = "https://api.github.com/user";

export type GitHubStrategyConfig = OAuthPluginConfig;

const githubProvider: OAuthProvider = {
  usePkce: false,
  defaultScope: ["read:user", "user:email"],

  buildAuthUrl({ clientId, redirectUri, scope, state }: AuthUrlParams): string {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: scope.join(" "),
      state,
    });
    return `${GITHUB_AUTH_URL}?${params.toString()}`;
  },

  async exchangeCode({ code, clientId, clientSecret, redirectUri }: CodeExchangeParams): Promise<string> {
    const response = await fetch(GITHUB_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
      }).toString(),
    });

    if (!response.ok) {
      throw new GeneralError("Failed to exchange authorization code with GitHub");
    }

    const data = (await response.json()) as Record<string, unknown>;
    const accessToken = data["access_token"];
    if (typeof accessToken !== "string") {
      throw new GeneralError("No access token in GitHub token response");
    }
    return accessToken;
  },

  async fetchProfile(accessToken: string): Promise<OAuthProfile> {
    const response = await fetch(GITHUB_USERINFO_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": "mantlejs-auth-github",
        Accept: "application/vnd.github+json",
      },
    });

    if (!response.ok) {
      throw new GeneralError("Failed to fetch GitHub user profile");
    }

    const data = (await response.json()) as Record<string, unknown>;
    const id = data["id"];
    if (typeof id !== "number" && typeof id !== "string") {
      throw new GeneralError("Missing id in GitHub user response");
    }

    return {
      id: String(id),
      email: typeof data["email"] === "string" ? data["email"] : undefined,
      name: typeof data["name"] === "string" ? data["name"] : undefined,
    };
  },
};

export function githubStrategy(config: GitHubStrategyConfig): MantlePlugin {
  return createOAuthPlugin("github", githubProvider, {
    ...config,
    scope: config.scope ?? githubProvider.defaultScope,
    entityIdField: config.entityIdField ?? "githubId",
  });
}
