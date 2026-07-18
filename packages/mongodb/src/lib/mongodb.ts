import { MongoClient, type MongoClientOptions } from "mongodb";
import type { MantleApplication, MantlePlugin } from "@mantlejs/mantle";

export interface MongoConfig {
  /** Atlas or self-hosted connection string, e.g. "mongodb+srv://…" */
  uri: string;
  /** Database name to operate on. */
  dbName: string;
  /** Full driver client options — TLS, pool sizing, etc. Passed through untouched. */
  clientOptions?: MongoClientOptions;
}

/**
 * Mantle plugin that opens one `MongoClient` and stores it on the application —
 * the same "connection lives on `app`, repositories pull it in their constructor"
 * pattern used by `@mantlejs/knex`. The client connects lazily on first operation.
 *
 * Stores `app.set("mongoClient", client)` and `app.set("mongoDb", client.db(dbName))`.
 * `app.teardown()` closes the client.
 *
 * @example
 * ```ts
 * const app = mantle().configure(mongodb({ uri: process.env.MONGODB_URI!, dbName: "app" }));
 * ```
 */
export function mongodb(config: MongoConfig): MantlePlugin {
  return (app: MantleApplication): void => {
    const client = new MongoClient(config.uri, config.clientOptions);
    app.set("mongoClient", client);
    app.set("mongoDb", client.db(config.dbName));

    const originalTeardown = (app as unknown as Record<string, unknown>)["teardown"] as () => Promise<void>;
    (app as unknown as Record<string, unknown>)["teardown"] = async () => {
      await originalTeardown.call(app);
      await client.close();
    };
  };
}
