import { describe, expect, it } from "vitest";
import { localEmbedder } from "./embedder.js";

describe("localEmbedder", () => {
  it("returns an L2-normalized vector of the configured dimensionality", async () => {
    const embedder = localEmbedder(16);
    const vector = await embedder.embed("Hello world, hello Mantle");
    expect(vector).toHaveLength(16);
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it("is deterministic for the same input", async () => {
    const embedder = localEmbedder(16);
    const a = await embedder.embed("team knowledge base");
    const b = await embedder.embed("team knowledge base");
    expect(a).toEqual(b);
  });

  it("produces different vectors for different text", async () => {
    const embedder = localEmbedder(16);
    const a = await embedder.embed("onboarding guide");
    const b = await embedder.embed("expense policy");
    expect(a).not.toEqual(b);
  });
});
