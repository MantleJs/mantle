import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import type { MantleApplication, MantlePlugin, ServiceParams } from "@mantlejs/mantle";
import { BadRequest, NotAuthenticated } from "@mantlejs/mantle";
import type { AuthConfig, AuthEngine, AuthResult, AuthStrategy, JwtPayload, TokenPair } from "./types.js";
import { memoryRefreshTokenStore } from "./refresh-token-store.js";

export function auth(config: AuthConfig): MantlePlugin {
  return (app: MantleApplication): void => {
    const strategies = new Map<string, AuthStrategy>();
    const refreshStore = config.refreshTokenStore ?? memoryRefreshTokenStore();

    const engine: AuthEngine = {
      config,

      createJwt(payload: JwtPayload, options?: { expiresIn?: string | number }): string {
        const signOpts: jwt.SignOptions = {
          expiresIn: (options?.expiresIn ?? config.expiresIn ?? "1d") as jwt.SignOptions["expiresIn"],
          ...(config.issuer !== undefined ? { issuer: config.issuer } : {}),
          ...(config.audience !== undefined ? { audience: config.audience as jwt.SignOptions["audience"] } : {}),
        };
        return jwt.sign(payload as object, config.secret, signOpts);
      },

      verifyJwt(token: string): JwtPayload {
        const verifyOpts: jwt.VerifyOptions = {
          algorithms: (config.algorithms ?? ["HS256"]) as jwt.Algorithm[],
          ...(config.issuer !== undefined ? { issuer: config.issuer } : {}),
          ...(config.audience !== undefined ? { audience: config.audience as jwt.VerifyOptions["audience"] } : {}),
        };
        return jwt.verify(token, config.secret, verifyOpts) as JwtPayload;
      },

      async createTokenPair(sub: string, accessExtra?: Record<string, unknown>): Promise<TokenPair> {
        const accessToken = engine.createJwt({ sub, ...accessExtra });
        const jti = randomUUID();
        const refreshToken = engine.createJwt(
          { sub, type: "refresh", jti },
          { expiresIn: config.refreshExpiresIn ?? "30d" },
        );
        const decoded = jwt.decode(refreshToken) as JwtPayload | null;
        await refreshStore.add(jti, sub, decoded?.exp ?? Math.floor(Date.now() / 1000));
        return { accessToken, refreshToken };
      },

      registerStrategy(strategy: AuthStrategy): void {
        strategies.set(strategy.name, strategy);
      },

      async authenticate(
        strategyName: string,
        data: Record<string, unknown>,
        params: ServiceParams,
      ): Promise<AuthResult> {
        const strategy = strategies.get(strategyName);
        if (!strategy) {
          throw new BadRequest(`Authentication strategy '${strategyName}' is not registered`);
        }
        return strategy.authenticate(data, params);
      },
    };

    // Built-in rotation strategy: POST /authentication { strategy: "refresh", refreshToken }.
    // A consumed-or-unknown jti on a still-valid JWT is a theft signal — the whole
    // token family for that subject is revoked.
    engine.registerStrategy({
      name: "refresh",

      async authenticate(data: Record<string, unknown>): Promise<AuthResult> {
        const refreshToken = data["refreshToken"];
        if (typeof refreshToken !== "string" || refreshToken.length === 0) {
          throw new NotAuthenticated("Invalid refresh token");
        }

        let payload: JwtPayload;
        try {
          payload = engine.verifyJwt(refreshToken);
        } catch {
          throw new NotAuthenticated("Invalid refresh token");
        }

        const { sub, jti } = payload;
        if (payload["type"] !== "refresh" || typeof sub !== "string" || typeof jti !== "string") {
          throw new NotAuthenticated("Invalid refresh token");
        }

        const consumed = await refreshStore.consume(jti);
        if (!consumed) {
          await refreshStore.revokeAll(sub);
          throw new NotAuthenticated("Refresh token reuse detected");
        }

        const pair = await engine.createTokenPair(sub);
        return { ...pair };
      },
    });

    app.set("auth", engine);

    app.use(
      "authentication",
      {
        async create(data: Record<string, unknown>, params?: ServiceParams): Promise<AuthResult> {
          const strategyName = data["strategy"];
          if (!strategyName || typeof strategyName !== "string") {
            throw new BadRequest("'strategy' field is required");
          }
          return engine.authenticate(strategyName, data, params ?? {});
        },
      },
      { methods: ["create"] },
    );
  };
}
