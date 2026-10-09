import nx from "@nx/eslint-plugin";
import baseConfig from "../eslint.config.mjs";

export default [
  ...nx.configs["flat/react"],
  ...baseConfig,
  {
    // Base primitives vendored verbatim from shadcn's aria-nova style (`npx shadcn add …`) — kept
    // byte-identical to upstream so re-vendoring is a clean diff, not linted to repo conventions.
    ignores: ["src/components/ui/**", "public/**", "out-tsc/**", "dist/**"],
  },
];
