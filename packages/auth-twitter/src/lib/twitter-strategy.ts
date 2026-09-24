import type { MantlePlugin } from "@mantlejs/mantle";
import { GeneralError } from "@mantlejs/mantle";
import { Twitter } from "arctic";
// eslint-disable-next-line @nx/enforce-module-boundaries -- spec uses await import() for vi.mock which makes Nx treat auth-oauth as lazy-loaded
import { createOAuthPlugin } from "@mantlejs/auth-oauth";
import type { OAuthPluginConfig, OAuthProvider, AuthUrlParams, CodeExchangeParams, OAuthProfile } from "@mantlejs/auth-oauth";

const TWITTER_USERINFO_URL = "https://api.x.com/2/users/me";

export type TwitterStrategyConfig = OAuthPluginConfig;

// Authorization URL and token exchange are delegated to Arctic (ADR-002); only
// profile normalization is X-specific enough to stay hand-written. `tweet.read`
// is included alongside `users.read` even though `/2/users/me`'s default fields
// don't strictly require it per X's own docs — X's own developer community has
// repeatedly reported 403s from this endpoint with `users.read` alone, so both
// are requested by default the same way every other confirmed-working integration does.
const twitterProvider: OAuthProvider = {
  usePkce: true,
  defaultScope: ["users.read", "tweet.read"],

  buildAuthUrl({ clientId, redirectUri, scope, state, codeVerifier }: AuthUrlParams): string {
    // The client secret is not used for URL construction.
    const twitter = new Twitter(clientId, "", redirectUri);
    return twitter.createAuthorizationURL(state, codeVerifier ?? "", scope).toString();
  },

  async exchangeCode({ code, clientId, clientSecret, redirectUri, codeVerifier }: CodeExchangeParams): Promise<string> {
    const twitter = new Twitter(clientId, clientSecret, redirectUri);
    try {
      const tokens = await twitter.validateAuthorizationCode(code, codeVerifier ?? "");
      return tokens.accessToken();
    } catch {
      throw new GeneralError("Failed to exchange authorization code with X (Twitter)");
    }
  },

  async fetchProfile(accessToken: string): Promise<OAuthProfile> {
    const response = await fetch(TWITTER_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      throw new GeneralError("Failed to fetch X (Twitter) user profile");
    }

    const body = (await response.json()) as Record<string, unknown>;
    const data = (body["data"] ?? {}) as Record<string, unknown>;
    const id = data["id"];
    if (typeof id !== "string") {
      throw new GeneralError("Missing id field in X (Twitter) users/me response");
    }

    return {
      id,
      // X's /2/users/me only returns confirmed_email behind app-level email access that most
      // apps don't have, and doesn't return it by default — email is left unset here rather
      // than requested via user.fields, since an unapproved field risks the whole call failing.
      email: undefined,
      name: typeof data["name"] === "string" ? data["name"] : undefined,
    };
  },
};

export function twitterStrategy(config: TwitterStrategyConfig): MantlePlugin {
  return createOAuthPlugin("twitter", twitterProvider, {
    ...config,
    scope: config.scope ?? twitterProvider.defaultScope,
    entityIdField: config.entityIdField ?? "twitterId",
  });
}
