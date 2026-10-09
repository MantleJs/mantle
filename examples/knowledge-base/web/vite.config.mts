/// <reference types='vitest' />
import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(() => ({
  root: import.meta.dirname,
  // Vite's default envDir is `root` (this folder). The example's single .env file lives
  // one level up, alongside the API's — this points Vite's VITE_* loading at it.
  envDir: "../",
  cacheDir: "../../../node_modules/.vite/examples/knowledge-base/web",
  server: {
    port: 4200,
    host: "localhost",
  },
  preview: {
    port: 4200,
    host: "localhost",
  },
  plugins: [react(), tailwindcss()],
  // shadcn's `@/` import alias (components.json) — the Mantle UI registry blocks import through it.
  resolve: {
    alias: { "@": resolve(import.meta.dirname, "./src") },
  },
  // Uncomment this if you are using workers.
  // worker: {
  //  plugins: [],
  // },
  build: {
    outDir: "./dist",
    emptyOutDir: true,
    reportCompressedSize: true,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
  define: {
    "import.meta.vitest": undefined,
  },
  test: {
    name: "knowledge-base-web",
    watch: false,
    globals: true,
    environment: "jsdom",
    include: ["{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],
    includeSource: ["src/**/*.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],
    reporters: ["default"],
    coverage: {
      reportsDirectory: "./test-output/vitest/coverage",
      provider: "v8" as const,
    },
  },
}));
