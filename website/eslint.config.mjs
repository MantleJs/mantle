import nx from "@nx/eslint-plugin";
import baseConfig from "../eslint.config.mjs";

export default [
  ...nx.configs["flat/react"],
  ...baseConfig,
  {
    // Build output, Astro's generated types, and the TypeDoc markdown starlight-typedoc writes at build time.
    ignores: ["dist/**", ".astro/**", "out-tsc/**", "src/content/docs/api/**"],
  },
];
