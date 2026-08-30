import { build } from "esbuild";

await build({
  entryPoints: ["src/web/app.ts"],
  outfile: "public/app.js",
  bundle: true,
  format: "iife",
  target: "es2020",
  platform: "browser",
  logLevel: "info",
});
