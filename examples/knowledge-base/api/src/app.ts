import { Redis } from "ioredis";
import {
  mantle,
  RepositoryService,
  VectorRepositoryService,
  type Logger,
  type MantleApplication,
} from "@mantlejs/mantle";
import { express } from "@mantlejs/express";
import { knex } from "@mantlejs/knex";
import { auth, authenticate, sanitizeUser } from "@mantlejs/auth";
import { localStrategy, hashPassword } from "@mantlejs/auth-local";
import { googleStrategy } from "@mantlejs/auth-google";
import { githubStrategy } from "@mantlejs/auth-github";
import { appleStrategy } from "@mantlejs/auth-apple";
import { microsoftStrategy } from "@mantlejs/auth-microsoft";
import { linkedinStrategy } from "@mantlejs/auth-linkedin";
import { redisRefreshTokenStore, redisStateStore } from "@mantlejs/auth-redis";
import { socketio } from "@mantlejs/socketio";
import { sync, redisAdapter } from "@mantlejs/sync";
import { upload, handleUpload } from "@mantlejs/storage";
import { config as loadConfig } from "@mantlejs/config";
import { validate } from "@mantlejs/schema";
import { logRequest, logError } from "@mantlejs/logger";
import { openapi } from "@mantlejs/openapi";
import { mcp } from "@mantlejs/mcp";
import { UserRepository } from "./repositories/user-repository.js";
import { ArticleRepository, ArticleVectorRepository } from "./repositories/article-repository.js";
import { ActivityLogRepository } from "./repositories/activity-log-repository.js";
import { CommentRepository } from "./repositories/comment-repository.js";
import { AttachmentRepository } from "./repositories/attachment-repository.js";
import type { User } from "./entities/user.js";
import type { Article } from "./entities/article.js";
import type { Comment } from "./entities/comment.js";
import type { Attachment } from "./entities/attachment.js";
import { sanitizeAuthResult } from "./hooks/sanitize-auth-result.js";
import { attachActor } from "./hooks/attach-actor.js";
import { mapUploadToAttachment } from "./hooks/map-upload-to-attachment.js";
import { ArticlesService } from "./services/articles-service.js";
import { createEmbedder } from "./embedder.js";
import { createStorageAdapter } from "./storage-adapter.js";
import { userCreateSchema, articleCreateSchema, commentCreateSchema } from "./schemas.js";

export interface AppConfig {
  /** Knex "pg" connection string. @default process.env.DATABASE_URL */
  databaseUrl?: string;
  jwtSecret?: string;
  /** When set (or `process.env.REDIS_URL` is), refresh tokens and OAuth state share this
   * store across instances instead of the in-memory default. */
  redisUrl?: string;
  /** Pre-built logger (e.g. from `createProductionLogger()`). Omit in tests — `logRequest`/
   * `logError` no-op gracefully without one. */
  logger?: Logger;
}

export function createApp(config: AppConfig = {}): MantleApplication {
  const databaseUrl =
    config.databaseUrl ?? process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/knowledge_base";
  const jwtSecret = config.jwtSecret ?? process.env.JWT_SECRET ?? "dev-secret-change-me";
  const redisUrl = config.redisUrl ?? process.env.REDIS_URL;
  const redis = redisUrl ? new Redis(redisUrl) : undefined;

  // openapi()/mcp() must configure after the HTTP transport but before any app.use() —
  // openapi() walks every registered service, including "authentication" (registered by
  // auth()'s own configure() call below).
  const app = mantle()
    // Only ever puts a single top-level "app" key into settings — @mantlejs/config flattens
    // every top-level config key onto app.set(), which would collide with plugin-owned
    // setting keys (e.g. "knex", "auth", "logger") if this file used those names.
    .configure(loadConfig())
    .configure(express(undefined, { cors: true }))
    .configure(openapi({ docsPath: "/docs", info: { title: "Mantle KB", version: "0.1.0" } }))
    .configure(
      mcp({
        transport: "http",
        events: true,
        services: {
          articles: ["find", "get", "create", "update"],
          search: ["similar"],
          comments: ["find", "get"],
          activity: ["find", "get"],
        },
      }),
    )
    .configure(knex({ client: "pg", connection: databaseUrl }))
    .configure(
      auth({
        secret: jwtSecret,
        ...(redis ? { refreshTokenStore: redisRefreshTokenStore(redis) } : {}),
      }),
    )
    .configure(localStrategy())
    // socket.io attaches its own request listener ahead of Express's middleware, so the
    // express({ cors: true }) above never runs for the /socket.io/* handshake — without this,
    // the web dev server (a different origin/port) can't open a socket at all, so realtime
    // updates (new comments, article edits) never arrive until the next full refetch.
    .configure(socketio({ cors: true }))
    .configure(upload({ storage: createStorageAdapter() }));

  if (config.logger) {
    app.set("logger", config.logger);
  }

  // Fans local socket.io broadcasts out across instances. Single-instance dev works fine
  // without it — socketio() alone covers realtime within one process.
  if (redisUrl) {
    app.configure(sync({ adapter: redisAdapter({ url: redisUrl }) }));
  }

  app.on("connection", (connection: unknown) => {
    app.channel("everyone").join(connection as Record<string, unknown>);
  });

  const requireUser = authenticate("jwt", { entity: "users" });
  // Register the SAME instance in before/after/error — it self-times via the context object.
  const requestLogger = logRequest();
  const errorLogger = logError();

  // The built-in "authentication" service (registered by auth()) returns the raw user
  // row in AuthResult.user on login — sanitize it here too, not just on "users".
  app.service("authentication").hooks({
    before: { all: [requestLogger] },
    after: { all: [requestLogger, sanitizeAuthResult()] },
    error: { all: [requestLogger, errorLogger] },
  });

  app.use("users", new RepositoryService<User>(new UserRepository(app)), {
    methods: ["find", "get", "create", "update", "patch", "remove"],
  });
  app.service("users").hooks({
    before: {
      all: [requestLogger],
      create: [validate(userCreateSchema), hashPassword()],
      find: [requireUser],
      get: [requireUser],
      update: [requireUser],
      patch: [requireUser],
      remove: [requireUser],
    },
    after: { all: [requestLogger, sanitizeUser()] },
    error: { all: [requestLogger, errorLogger] },
  });

  const webUrl = process.env.WEB_URL ?? "http://localhost:4200";
  configureOAuthStrategies(app, redis, webUrl);

  const embedder = createEmbedder();
  const articlesVectorRepo = new ArticleVectorRepository(app);

  app.use(
    "articles",
    new ArticlesService(new ArticleRepository(app), new ActivityLogRepository(app), articlesVectorRepo, embedder),
    { methods: ["find", "get", "create", "update", "patch", "remove"] },
  );
  app.service("articles").hooks({
    before: {
      all: [requestLogger],
      create: [requireUser, validate(articleCreateSchema), attachActor("authorId")],
      update: [requireUser],
      patch: [requireUser],
      remove: [requireUser],
    },
    after: { all: [requestLogger] },
    error: { all: [requestLogger, errorLogger] },
  });

  // Read-oriented: same table as "articles", exposing only the vector-search custom method.
  app.use("search", new VectorRepositoryService<Article>(articlesVectorRepo, { topK: { default: 10, max: 50 } }), {
    methods: ["similar"],
  });
  app.service("search").hooks({
    before: { all: [requestLogger] },
    after: { all: [requestLogger] },
    error: { all: [requestLogger, errorLogger] },
  });

  app.use("comments", new RepositoryService<Comment>(new CommentRepository(app)), {
    methods: ["find", "get", "create", "update", "patch", "remove"],
  });
  app.service("comments").hooks({
    before: {
      all: [requestLogger],
      create: [requireUser, validate(commentCreateSchema), attachActor("authorId")],
      update: [requireUser],
      patch: [requireUser],
      remove: [requireUser],
    },
    after: { all: [requestLogger] },
    error: { all: [requestLogger, errorLogger] },
  });
  // Realtime: article edits and new comments fan out to every connected client.
  app.service("comments").publish(() => app.channel("everyone"));
  app.service("articles").publish(() => app.channel("everyone"));

  app.use("attachments", new RepositoryService<Attachment>(new AttachmentRepository(app)), {
    methods: ["find", "get", "create", "remove"],
  });
  app.service("attachments").hooks({
    before: {
      all: [requestLogger],
      create: [requireUser, handleUpload("file", { required: true }), mapUploadToAttachment()],
      remove: [requireUser],
    },
    after: { all: [requestLogger] },
    error: { all: [requestLogger, errorLogger] },
  });

  app.use("activity", new RepositoryService(new ActivityLogRepository(app)), {
    methods: ["find", "get"],
  });
  app.service("activity").hooks({
    before: { all: [requireUser, requestLogger] },
    after: { all: [requestLogger] },
    error: { all: [requestLogger, errorLogger] },
  });

  return app;
}

/**
 * Each strategy activates only when its client credentials are present in the environment.
 * `redirectUrl` sends the browser back to the web app with tokens (or an error) in the URL
 * fragment on completion — required here since `/auth/{provider}` is a full-page navigation
 * (an `<a href>`, not `fetch`), so the JSON-body response `@mantlejs/auth-oauth` returns by
 * default would otherwise strand the user on the API's own origin.
 */
function configureOAuthStrategies(app: MantleApplication, redis: Redis | undefined, webUrl: string): void {
  const stateStore = redis ? redisStateStore(redis) : undefined;
  const redirectUrl = `${webUrl}/`;

  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    app.configure(
      googleStrategy({
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        redirectUrl,
        ...(stateStore ? { stateStore } : {}),
      }),
    );
  }

  if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
    app.configure(
      githubStrategy({
        clientId: process.env.GITHUB_CLIENT_ID,
        clientSecret: process.env.GITHUB_CLIENT_SECRET,
        redirectUrl,
        ...(stateStore ? { stateStore } : {}),
      }),
    );
  }

  if (process.env.APPLE_CLIENT_ID && process.env.APPLE_TEAM_ID && process.env.APPLE_KEY_ID && process.env.APPLE_PRIVATE_KEY) {
    app.configure(
      appleStrategy({
        clientId: process.env.APPLE_CLIENT_ID,
        teamId: process.env.APPLE_TEAM_ID,
        keyId: process.env.APPLE_KEY_ID,
        privateKey: process.env.APPLE_PRIVATE_KEY,
        redirectUrl,
        ...(stateStore ? { stateStore } : {}),
      }),
    );
  }

  if (process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET) {
    app.configure(
      microsoftStrategy({
        clientId: process.env.MICROSOFT_CLIENT_ID,
        clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
        tenant: process.env.MICROSOFT_TENANT ?? "common",
        redirectUrl,
        ...(stateStore ? { stateStore } : {}),
      }),
    );
  }

  if (process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET) {
    app.configure(
      linkedinStrategy({
        clientId: process.env.LINKEDIN_CLIENT_ID,
        clientSecret: process.env.LINKEDIN_CLIENT_SECRET,
        redirectUrl,
        ...(stateStore ? { stateStore } : {}),
      }),
    );
  }
}
