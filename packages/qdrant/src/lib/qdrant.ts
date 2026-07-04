import { QdrantClient } from "@qdrant/js-client-rest";
import type { QdrantClientParams } from "@qdrant/js-client-rest";
import type { MantleApplication, MantlePlugin } from "@mantlejs/mantle";

export type QdrantConfig = QdrantClientParams;

/**
 * Mantle plugin that creates a Qdrant client and stores it on the application.
 * The `url` defaults to `QDRANT_URL` and `apiKey` to `QDRANT_API_KEY` environment
 * variables when omitted.
 *
 * @example
 * ```ts
 * const app = mantle().configure(qdrant({ url: process.env.QDRANT_URL, apiKey: process.env.QDRANT_API_KEY }));
 * ```
 */
export function qdrant(config: QdrantConfig = {}): MantlePlugin {
  return (app: MantleApplication): void => {
    const resolved: QdrantConfig = {
      url: process.env["QDRANT_URL"] ?? "http://localhost:6333",
      apiKey: process.env["QDRANT_API_KEY"],
      ...config,
    };
    const client = new QdrantClient(resolved);
    app.set("qdrant", client);
  };
}
