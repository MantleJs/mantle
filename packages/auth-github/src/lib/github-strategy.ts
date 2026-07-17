import type { MantlePlugin } from "@mantlejs/mantle";
import { GeneralError } from "@mantlejs/mantle";
import { GitHub } from "arctic";
// eslint-disable-next-line @nx/enforce-module-boundaries -- spec uses await import() for vi.mock which makes Nx treat auth-oauth as lazy-loaded
import { createOAuthPlugin } from "@mantlejs/auth-oauth";
import type {
  OAuthPluginConfig,
  OAuthProvider,
  AuthUrlParams,
  CodeExchangeParams,
  OAuthProfile,
} from "@mantlejs/auth-oauth";

const GITHUB_USERINFO_URL = "https://api.github.com/user";

export type GitHubStrategyConfig = OAuthPluginConfig;

// Authorization URL and token exchange are delegated to Arctic (ADR-002); only
// profile normalization is GitHub-specific enough to stay hand-written.
const githubProvider: OAuthProvider = {
  usePkce: false,
  defaultScope: ["read:user", "user:email"],

  buildAuthUrl({ clientId, redirectUri, scope, state }: AuthUrlParams): string {
    // The client secret is not used for URL construction.
    const github = new GitHub(clientId, "", redirectUri);
    return github.createAuthorizationURL(state, scope).toString();
  },

  async exchangeCode({ code, clientId, clientSecret, redirectUri }: CodeExchangeParams): Promise<string> {
    const github = new GitHub(clientId, clientSecret, redirectUri);
    try {
      const tokens = await github.validateAuthorizationCode(code);
      return tokens.accessToken();
    } catch {
      throw new GeneralError("Failed to exchange authorization code with GitHub");
    }
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
