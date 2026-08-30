import type { Knex } from "knex";
import type { MantleApplication } from "@mantlejs/mantle";

/** Matches `Embedder`'s default local dimensionality — see `src/embedder.ts`. */
export const EMBEDDING_DIMENSIONS = Number(process.env.EMBEDDER_DIMENSIONS ?? 256);

// Column names are camelCase — `KnexRepository`'s timestamp stamping writes
// `createdAt`/`updatedAt`, not knex's snake_case `timestamps()` default.

/** Idempotent schema bootstrap — no separate migration tooling for a demo app. */
export async function migrate(app: MantleApplication): Promise<void> {
  const db = app.get<Knex>("knex");

  if (!(await db.schema.hasTable("users"))) {
    await db.schema.createTable("users", (t) => {
      t.increments("id");
      t.string("email").unique();
      t.string("password");
      t.string("name");
      t.string("googleId").unique();
      t.string("githubId").unique();
      t.string("appleId").unique();
      t.string("microsoftId").unique();
      t.string("linkedinId").unique();
      t.timestamp("createdAt").notNullable();
      t.timestamp("updatedAt").notNullable();
    });
  }

  if (!(await db.schema.hasTable("articles"))) {
    await db.raw('CREATE EXTENSION IF NOT EXISTS "vector"');
    await db.schema.createTable("articles", (t) => {
      t.increments("id");
      t.string("title").notNullable();
      t.text("body").notNullable();
      t.integer("authorId").notNullable().references("id").inTable("users");
      t.timestamp("createdAt").notNullable();
      t.timestamp("updatedAt").notNullable();
    });
    await db.raw(`ALTER TABLE articles ADD COLUMN embedding vector(${EMBEDDING_DIMENSIONS})`);
    await db.raw("CREATE INDEX articles_embedding_idx ON articles USING ivfflat (embedding vector_cosine_ops)");
  }

  if (!(await db.schema.hasTable("activity_log"))) {
    await db.schema.createTable("activity_log", (t) => {
      t.increments("id");
      t.string("entityType").notNullable();
      t.integer("entityId").notNullable();
      t.string("action").notNullable();
      t.integer("actorId").references("id").inTable("users");
      t.timestamp("createdAt").notNullable();
      t.timestamp("updatedAt").notNullable();
    });
  }

  if (!(await db.schema.hasTable("comments"))) {
    await db.schema.createTable("comments", (t) => {
      t.increments("id");
      t.integer("articleId").notNullable().references("id").inTable("articles");
      t.integer("authorId").notNullable().references("id").inTable("users");
      t.text("body").notNullable();
      t.timestamp("createdAt").notNullable();
      t.timestamp("updatedAt").notNullable();
    });
  }

  if (!(await db.schema.hasTable("attachments"))) {
    await db.schema.createTable("attachments", (t) => {
      t.increments("id");
      t.integer("articleId").references("id").inTable("articles");
      t.string("filename").notNullable();
      t.string("mimetype").notNullable();
      t.integer("size").notNullable();
      t.string("key").notNullable();
      t.integer("uploadedBy").references("id").inTable("users");
      t.timestamp("createdAt").notNullable();
      t.timestamp("updatedAt").notNullable();
    });
  }
}
