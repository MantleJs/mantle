import { Pinecone } from "@pinecone-database/pinecone";
import type { PineconeConfiguration } from "@pinecone-database/pinecone";
import type { MantleApplication, MantlePlugin } from "@mantlejs/mantle";

export type PineconeConfig = Partial<PineconeConfiguration>;

/**
 * Mantle plugin that creates a Pinecone client and stores it on the application.
 * The `apiKey` defaults to the `PINECONE_API_KEY` environment variable when omitted.
 *
 * @example
 * ```ts
 * const app = mantle().configure(pinecone({ apiKey: process.env.PINECONE_API_KEY }));
 * ```
 */
export function pinecone(config: PineconeConfig = {}): MantlePlugin {
  return (app: MantleApplication): void => {
    const client = new Pinecone(config as PineconeConfiguration);
    app.set("pinecone", client);
  };
}
