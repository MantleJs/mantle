import type { MantleApplication, MantlePlugin } from "@mantlejs/core";
import { NotAuthenticated } from "@mantlejs/core";
import type { AuthEngine } from "@mantlejs/auth";
import type { OAuthProvider, OAuthPluginConfig } from "./types.js";
import { generateState, generateCodeVerifier, generateCodeChallenge } from "./pkce.js";
import { createStateStore } from "./state-store.js";
import { findOrCreateUser } from "./find-or-create.js";

interface RouterLike {
  get(
    path: string,
    handler: (req: IncomingLike, res: OutgoingLike, next: (err?: unknown) => void) => void | Promise<void>,
  ): void;
}

interface IncomingLike {
  protocol: string;
  query: Record<string, unknown>;
  get(header: string): string | undefined;
}

interface OutgoingLike {
  redirect(url: string): void;
  json(body: unknown): void;
}

export function createOAuthPlugin(
  providerKey: string,
  provider: OAuthProvider,
  config: OAuthPluginConfig,
): MantlePlugin {
  return (app: MantleApplication): void => {
    const engine = app.get<AuthEngine>("auth");
    if (!engine) {
      throw new Error(`@mantlejs/auth must be configured before @mantlejs/auth-${providerKey}`);
    }

    const router = app.get<RouterLike>("express");
    if (!router) {
      throw new Error(`@mantlejs/express must be configured before @mantlejs/auth-${providerKey}`);
    }

    const callbackPath = config.callbackUrl ?? `/auth/${providerKey}/callback`;
    const scope = config.scope ?? provider.defaultScope;
    const entity = config.entity ?? "users";
    const entityIdField = config.entityIdField ?? `${providerKey}Id`;

    const stateStore = createStateStore();

    router.get(`/auth/${providerKey}`, (req, res): void => {
      stateStore.cleanup();

      const state = generateState();
      const host = req.get("host") ?? "";
      const redirectUri = `${req.protocol}://${host}${callbackPath}`;

      let codeVerifier: string | undefined;
      let codeChallenge: string | undefined;

      if (provider.usePkce) {
        codeVerifier = generateCodeVerifier();
        codeChallenge = generateCodeChallenge(codeVerifier);
      }

      stateStore.set(state, { codeVerifier });

      const authUrl = provider.buildAuthUrl({ clientId: config.clientId, redirectUri, scope, state, codeChallenge });
      res.redirect(authUrl);
    });

    router.get(callbackPath, async (req, res, next): Promise<void> => {
      try {
        const query = req.query as Record<string, string | undefined>;
        const { code, state, error } = query;

        if (error) {
          throw new NotAuthenticated(`OAuth error: ${error}`);
        }

        if (!code || !state) {
          throw new NotAuthenticated("Missing code or state parameter");
        }

        const pending = stateStore.get(state);
        if (!pending) {
          throw new NotAuthenticated("Invalid or expired state");
        }
        stateStore.delete(state);

        const host = req.get("host") ?? "";
        const redirectUri = `${req.protocol}://${host}${callbackPath}`;

        const providerToken = await provider.exchangeCode({
          code,
          clientId: config.clientId,
          clientSecret: config.clientSecret,
          redirectUri,
          codeVerifier: pending.codeVerifier,
        });

        const profile = await provider.fetchProfile(providerToken);
        const user = await findOrCreateUser(app, entity, entityIdField, profile);

        const sub = String(user["id"] ?? user["_id"]);
        const accessToken = engine.createJwt({ sub });
        const refreshToken = engine.createJwt({ sub, type: "refresh" });

        res.json({ accessToken, refreshToken, user });
      } catch (err) {
        next(err);
      }
    });
  };
}
