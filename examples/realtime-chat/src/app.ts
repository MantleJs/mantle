import { fileURLToPath } from "node:url";
import expressLib from "express";
import type { Knex } from "knex";
import {
  mantle,
  RepositoryService,
  type HookContext,
  type HookFunction,
  type MantleApplication,
} from "@mantlejs/mantle";
import { express } from "@mantlejs/express";
import { knex } from "@mantlejs/knex";
import { auth, authenticate, sanitizeUser } from "@mantlejs/auth";
import { localStrategy, hashPassword } from "@mantlejs/auth-local";
import { socketio } from "@mantlejs/socketio";
import { UserRepository, MessageRepository } from "./repositories.js";
import type { Message, User } from "./entities.js";

export interface AppConfig {
  /** Knex sqlite connection filename. `":memory:"` for tests. @default "./chat.db" */
  dbFilename?: string;
  jwtSecret?: string;
}

/** Stamps the authenticated sender onto a new message — never trust a client-supplied `userId`. */
function attachSender(): HookFunction {
  return (context: HookContext) => {
    const user = context.params.user as User | undefined;
    if (user && context.data) {
      (context.data as Partial<Message>).userId = user.id;
    }
    return context;
  };
}

/**
 * `sanitizeUser()` only strips top-level result fields — the built-in "authentication"
 * service nests the user record under `result.user`, so the password hash needs its own hook.
 */
function sanitizeAuthResult(): HookFunction {
  return (context: HookContext) => {
    const result = context.result as { user?: Partial<User> } | undefined;
    if (context.params.provider && result?.user) {
      // JSON.stringify drops undefined-valued keys, so this omits password on the wire.
      result.user = { ...result.user, password: undefined };
    }
    return context;
  };
}

export function createApp(config: AppConfig = {}): MantleApplication {
  const publicDir = fileURLToPath(new URL("../public", import.meta.url));
  const expressApp = expressLib();
  expressApp.use(expressLib.static(publicDir));

  const app = mantle()
    .configure(express(expressApp, { cors: true }))
    // A single pooled connection: sqlite doesn't handle concurrent writers well, and a
    // ":memory:" database is otherwise isolated per physical connection (each pool member
    // would see an empty database).
    .configure(
      knex({
        client: "better-sqlite3",
        connection: { filename: config.dbFilename ?? "./chat.db" },
        pool: { min: 1, max: 1 },
      }),
    )
    .configure(auth({ secret: config.jwtSecret ?? process.env.JWT_SECRET ?? "dev-secret-change-me" }))
    .configure(localStrategy())
    .configure(socketio());

  const requireUser = authenticate("jwt", { entity: "users" });

  // The built-in "authentication" service (registered by auth()) returns the raw user
  // row in AuthResult.user on login — sanitize it here too, not just on "users".
  app.service("authentication").hooks({ after: { all: [sanitizeAuthResult()] } });

  app.use("users", new RepositoryService<User>(new UserRepository(app), { fields: ["email", "name"] }), {
    methods: ["find", "get", "create", "update", "patch", "remove"],
  });
  app.service("users").hooks({
    before: {
      create: [hashPassword()],
      find: [requireUser],
      get: [requireUser],
      update: [requireUser],
      patch: [requireUser],
      remove: [requireUser],
    },
    after: { all: [sanitizeUser()] },
  });

  app.use("messages", new RepositoryService<Message>(new MessageRepository(app), { fields: ["userId", "createdAt"] }), {
    methods: ["find", "get", "create", "remove"],
  });
  app.service("messages").hooks({
    before: { create: [requireUser, attachSender()] },
  });
  app.service("messages").publish(() => app.channel("everyone"));

  app.on("connection", (connection: unknown) => {
    app.channel("everyone").join(connection as Record<string, unknown>);
  });

  return app;
}

/** Idempotent schema bootstrap — no separate migration tooling for a single-page demo. */
export async function migrate(app: MantleApplication): Promise<void> {
  const db = app.get<Knex>("knex");

  // `messages`' column names are camelCase — `KnexRepository`'s default timestamp
  // stamping writes `createdAt`/`updatedAt`, not knex's snake_case `timestamps()`
  // default. `users` overrides columnCase to "snake_case" instead (see
  // UserRepository in repositories.ts) — the two tables intentionally use
  // different conventions here to demonstrate the override. Note the `User`
  // entity's own fields stay camelCase in both cases; only the columns differ.
  if (!(await db.schema.hasTable("users"))) {
    await db.schema.createTable("users", (t) => {
      t.increments("id");
      t.string("email").notNullable().unique();
      t.string("password").notNullable();
      t.string("name").notNullable();
      t.timestamp("created_at").notNullable();
      t.timestamp("updated_at").notNullable();
    });
  }

  if (!(await db.schema.hasTable("messages"))) {
    await db.schema.createTable("messages", (t) => {
      t.increments("id");
      t.integer("userId").notNullable().references("id").inTable("users");
      t.string("text").notNullable();
      t.timestamp("createdAt").notNullable();
      t.timestamp("updatedAt").notNullable();
    });
  }
}
