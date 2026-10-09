import { defineCollection } from "astro:content";
import { docsSchema } from "@astrojs/starlight/schema";
import { docsWithReadmes } from "./loaders/docs-with-readmes";

export const collections = {
  docs: defineCollection({ loader: docsWithReadmes(), schema: docsSchema() }),
};
