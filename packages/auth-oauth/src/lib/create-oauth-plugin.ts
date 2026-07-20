import type { HttpRequestLike, HttpResponseLike, HttpRouterLike, MantleApplication, MantlePlugin } from "@mantlejs/mantle";
import { NotAuthenticated } from "@mantlejs/mantle";
import type { AuthEngine } from "@mantlejs/auth";
import { generateState, generateCodeVerifier } from "arctic";
import type { CallbackExtras, OAuthProvider, OAuthPluginConfig } from "./types.js";
import { createStateStore } from "./state-store.js";
import { findOrCreateUser } from "./find-or-create.js";

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

    // "express" fallback covers transports that predate the "http:router" contract.
    const router = app.get<HttpRouterLike>("http:router") ?? app.get<HttpRouterLike>("express");
    if (!router) {
      throw new Error(
        `An HTTP transport (@mantlejs/express, @mantlejs/koa, or @mantlejs/http) must be configured before @mantlejs/auth-${providerKey}`,
      );
    }

    const callbackPath = config.callbackUrl ?? `/auth/${providerKey}/callback`;
    const scope = config.scope ?? provider.defaultScope;
    const entity = config.entity ?? "users";
    const entityIdField = config.entityIdField ?? `${providerKey}Id`;

    // In-memory by default. Multi-instance deployments (e.g. Cloud Run) must inject a shared store.
    const stateStore = config.stateStore ?? createStateStore();

    router.get(`/auth/${providerKey}`, async (req, res, next): Promise<void> => {
      try {
        await stateStore.cleanup();

        const state = generateState();
        const host = req.get("host") ?? "";
        const redirectUri = `${req.protocol}://${host}${callbackPath}`;

        const codeVerifier = provider.usePkce ? generateCodeVerifier() : undefined;

        await stateStore.set(state, { codeVerifier });

        const authUrl = provider.buildAuthUrl({ clientId: config.clientId, redirectUri, scope, state, codeVerifier });
        res.redirect(authUrl);
      } catch (err) {
        next(err);
      }
    });

    const handleCallback = async (
      req: HttpRequestLike,
      res: HttpResponseLike,
      payload: Record<string, string | undefined>,
      extras?: CallbackExtras,
    ): Promise<void> => {
      const { code, state, error } = payload;

      if (error) {
        throw new NotAuthenticated(`OAuth error: ${error}`);
      }

      if (!code || !state) {
        throw new NotAuthenticated("Missing code or state parameter");
      }

      const pending = await stateStore.get(state);
      if (!pending) {
        throw new NotAuthenticated("Invalid or expired state");
      }
      await stateStore.delete(state);

      const host = req.get("host") ?? "";
      const redirectUri = `${req.protocol}://${host}${callbackPath}`;

      const providerToken = await provider.exchangeCode({
        code,
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        redirectUri,
        codeVerifier: pending.codeVerifier,
      });

      const profile = extras
        ? await provider.fetchProfile(providerToken, extras)
        : await provider.fetchProfile(providerToken);
      const user = await findOrCreateUser(app, entity, entityIdField, profile);

      const sub = String(user["id"] ?? user["_id"]);
      const { accessToken, refreshToken } = await engine.createTokenPair(sub);

      res.json({ accessToken, refreshToken, user });
    };

    if (provider.callbackMethod === "POST") {
      router.post(callbackPath, async (req, res, next): Promise<void> => {
        try {
          const body = (typeof req.body === "object" && req.body !== null ? req.body : {}) as Record<string, unknown>;
          const payload: Record<string, string | undefined> = {
            code: typeof body["code"] === "string" ? body["code"] : undefined,
            state: typeof body["state"] === "string" ? body["state"] : undefined,
            error: typeof body["error"] === "string" ? body["error"] : undefined,
          };
          await handleCallback(req, res, payload, { body });
        } catch (err) {
          next(err);
        }
      });
    } else {
      router.get(callbackPath, async (req, res, next): Promise<void> => {
        try {
          await handleCallback(req, res, req.query as Record<string, string | undefined>);
        } catch (err) {
          next(err);
        }
      });
    }
  };
}
