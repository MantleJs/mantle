import baseConfig from "../../eslint.config.mjs";

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
          // better-sqlite3: selected by the "client" string passed to @mantlejs/knex, not
          // imported directly. socket.io-client: loaded via dynamic import inside
          // @mantlejs/client — Nx cannot see either in the static import graph.
          ignoredDependencies: ["better-sqlite3", "socket.io-client"],
        },
      ],
    },
    languageOptions: {
      parser: await import("jsonc-eslint-parser"),
    },
  },
  {
    ignores: ["**/out-tsc", "**/public/app.js"],
  },
];
