import jwt from "jsonwebtoken";
import type { MantleApplication, MantlePlugin, ServiceParams } from "@mantlejs/mantle";
import { BadRequest } from "@mantlejs/mantle";
import type { AuthConfig, AuthEngine, AuthResult, AuthStrategy, JwtPayload } from "./types.js";

export function auth(config: AuthConfig): MantlePlugin {
  return (app: MantleApplication): void => {
    const strategies = new Map<string, AuthStrategy>();

    const engine: AuthEngine = {
      config,

      createJwt(payload: JwtPayload): string {
        const signOpts: jwt.SignOptions = {
          expiresIn: (config.expiresIn ?? "1d") as jwt.SignOptions["expiresIn"],
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
