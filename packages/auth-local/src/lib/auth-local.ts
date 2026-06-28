import { verify } from "@node-rs/argon2";
import type { MantleApplication, MantlePlugin, Paginated } from "@mantlejs/mantle";
import { NotAuthenticated } from "@mantlejs/mantle";
import type { AuthEngine, AuthResult, AuthStrategy } from "@mantlejs/auth";

export interface LocalStrategyConfig {
  usernameField?: string;
  passwordField?: string;
  entityService?: string;
}

type UserLike = Record<string, unknown>;

export function localStrategy(config: LocalStrategyConfig = {}): MantlePlugin {
  return (app: MantleApplication): void => {
    const engine = app.get<AuthEngine>("auth");
    if (!engine) {
      throw new Error("@mantlejs/auth must be configured before @mantlejs/auth-local");
    }

    const usernameField = config.usernameField ?? "email";
    const passwordField = config.passwordField ?? "password";
    const entityService = config.entityService ?? "users";

    const strategy: AuthStrategy = {
      name: "local",

      async authenticate(data: Record<string, unknown>): Promise<AuthResult> {
        const username = data[usernameField];
        const password = data[passwordField];

        if (!username || !password || typeof username !== "string" || typeof password !== "string") {
          throw new NotAuthenticated("Invalid credentials");
        }

        let user: UserLike | undefined;
        try {
          const result = await app.service<UserLike>(entityService).find({
            query: { [usernameField]: username },
          });
          const rows = Array.isArray(result) ? result : (result as Paginated<UserLike>).data;
          user = rows[0];
        } catch {
          throw new NotAuthenticated("Invalid credentials");
        }

        if (!user) {
          throw new NotAuthenticated("Invalid credentials");
        }

        const storedHash = user[passwordField];
        if (typeof storedHash !== "string") {
          throw new NotAuthenticated("Invalid credentials");
        }

        const valid = await verify(storedHash, password);
        if (!valid) {
          throw new NotAuthenticated("Invalid credentials");
        }

        const sub = String(user["id"] ?? user["_id"]);
        const accessToken = engine.createJwt({ sub });

        return { accessToken, user };
      },
    };

    engine.registerStrategy(strategy);
  };
}
