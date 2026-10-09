import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: "../node_modules/.vite/registry",
  resolve: {
    // Same `@/` alias every shadcn project uses — blocks import `@/components/ui/*` exactly as
    // they will appear once installed into a consumer app.
    alias: { "@": resolve(import.meta.dirname, "./src") },
  },
  test: {
    name: "ui-registry",
    watch: false,
    globals: true,
    environment: "jsdom",
    include: ["src/**/*.spec.{ts,tsx}"],
    setupFiles: ["./src/test/setup.ts"],
    reporters: ["default"],
    coverage: {
      reportsDirectory: "./test-output/vitest/coverage",
      provider: "v8" as const,
    },
  },
}));
