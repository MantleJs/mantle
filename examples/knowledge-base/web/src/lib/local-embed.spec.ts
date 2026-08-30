import { describe, expect, it } from "vitest";
import { localEmbed } from "./local-embed.js";

describe("localEmbed", () => {
  it("returns a 256-dimensional, L2-normalized vector", () => {
    const vector = localEmbed("Hello world, hello Mantle");
    expect(vector).toHaveLength(256);
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it("is deterministic", () => {
    expect(localEmbed("onboarding guide")).toEqual(localEmbed("onboarding guide"));
  });
});
