import type { MantlePlugin } from "@mantlejs/mantle";
import { GeneralError } from "@mantlejs/mantle";
import { Apple } from "arctic";
// eslint-disable-next-line @nx/enforce-module-boundaries -- spec uses await import() for vi.mock which makes Nx treat auth-oauth as lazy-loaded
import { createOAuthPlugin } from "@mantlejs/auth-oauth";
import type {
  OAuthPluginConfig,
  OAuthProvider,
  AuthUrlParams,
  CodeExchangeParams,
  OAuthProfile,
  CallbackExtras,
} from "@mantlejs/auth-oauth";

export interface AppleStrategyConfig extends Omit<OAuthPluginConfig, "clientSecret"> {
  /** Apple Developer Team ID (10 characters, from the membership page). */
  teamId: string;
  /** Key ID of the Sign in with Apple private key. */
  keyId: string;
  /** PKCS#8 PEM contents of the .p8 private key downloaded from Apple. */
  privateKey: string;
}

/** Arctic's `Apple` client takes the key as PKCS#8 DER bytes; the .p8 file Apple hands out is PEM. */
function pemToPkcs8(pem: string): Uint8Array {
  const base64 = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "");
  return new Uint8Array(Buffer.from(base64, "base64"));
}

function decodeIdTokenPayload(idToken: string): Record<string, unknown> {
  const payload = idToken.split(".")[1];
  if (!payload) {
    throw new GeneralError("Malformed Apple id_token");
  }
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    throw new GeneralError("Malformed Apple id_token");
  }
}

// Apple sends a `user` JSON string in the callback body on the *first* authorization only.
// find-or-create persists the name at creation, so its absence on later logins loses nothing.
function extractFirstLoginName(extras?: CallbackExtras): string | undefined {
  const raw = extras?.body?.["user"];
  if (typeof raw !== "string") {
    return undefined;
  }
  try {
    const user = JSON.parse(raw) as { name?: { firstName?: unknown; lastName?: unknown } };
    const parts = [user.name?.firstName, user.name?.lastName].filter(
      (part): part is string => typeof part === "string" && part.length > 0,
    );
    return parts.length > 0 ? parts.join(" ") : undefined;
  } catch {
    return undefined;
  }
}

// Authorization URL, token exchange, and the per-exchange ES256 client-secret JWT are delegated
// to Arctic (ADR-002); Apple keeps CSRF protection on the state round-trip — no PKCE for web
// form_post flows.
function createAppleProvider(teamId: string, keyId: string, pkcs8PrivateKey: Uint8Array): OAuthProvider {
  return {
    usePkce: false,
    defaultScope: ["name", "email"],
    callbackMethod: "POST",

    buildAuthUrl({ clientId, redirectUri, scope, state }: AuthUrlParams): string {
      const apple = new Apple(clientId, teamId, keyId, pkcs8PrivateKey, redirectUri);
      const url = apple.createAuthorizationURL(state, scope);
      // Apple requires form_post whenever the name/email scopes are requested.
      url.searchParams.set("response_mode", "form_post");
      return url.toString();
    },

    async exchangeCode({ code, clientId, redirectUri }: CodeExchangeParams): Promise<string> {
      const apple = new Apple(clientId, teamId, keyId, pkcs8PrivateKey, redirectUri);
      try {
        const tokens = await apple.validateAuthorizationCode(code);
        // Apple has no userinfo endpoint — the id_token is the profile source. It was obtained
        // seconds earlier directly from Apple's token endpoint over TLS, so fetchProfile decodes
        // its payload without a JWKS round-trip.
        return tokens.idToken();
      } catch {
        throw new GeneralError("Failed to exchange authorization code with Apple");
      }
    },

    async fetchProfile(idToken: string, extras?: CallbackExtras): Promise<OAuthProfile> {
      const payload = decodeIdTokenPayload(idToken);
      const id = payload["sub"];
      if (typeof id !== "string") {
        throw new GeneralError("Missing sub claim in Apple id_token");
      }

      return {
        id,
        email: typeof payload["email"] === "string" ? payload["email"] : undefined,
        name: extractFirstLoginName(extras),
      };
    },
  };
}

export function appleStrategy(config: AppleStrategyConfig): MantlePlugin {
  const { teamId, keyId, privateKey, ...oauthConfig } = config;
  const provider = createAppleProvider(teamId, keyId, pemToPkcs8(privateKey));
  // Arctic signs the ES256 client-secret JWT from the key material per exchange — no static
  // secret ever exists, but createOAuthPlugin's config shape requires the field.
  return createOAuthPlugin("apple", provider, {
    ...oauthConfig,
    clientSecret: "",
    scope: config.scope ?? provider.defaultScope,
    entityIdField: config.entityIdField ?? "appleId",
  });
}
