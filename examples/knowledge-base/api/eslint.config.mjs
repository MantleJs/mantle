import baseConfig from "../../../eslint.config.mjs";

export default [
  ...baseConfig,
  {
    files: ["**/*.json"],
    rules: {
      "@nx/dependency-checks": [
        "error",
        {
          ignoredFiles: [
            "{projectRoot}/eslint.config.{js,cjs,mjs,ts,cts,mts}",
            "{projectRoot}/vitest.config.{js,ts,mjs,mts}",
          ],
          // pg: selected by the "client" string passed to @mantlejs/knex. pino/pino-pretty:
          // lazily required inside @mantlejs/logger's createLogger(). Neither is imported
          // directly here, so Nx cannot see them in the import graph.
          ignoredDependencies: ["pg", "pino", "pino-pretty"],
        },
      ],
    },
    languageOptions: {
      parser: await import("jsonc-eslint-parser"),
    },
  },
  {
    ignores: ["**/out-tsc"],
  },
];
