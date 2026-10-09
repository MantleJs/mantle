// @ts-check
import { existsSync } from "node:fs";
import { cp } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import react from "@astrojs/react";
import starlight from "@astrojs/starlight";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";
import starlightLinksValidator from "starlight-links-validator";
import starlightLlmsTxt from "starlight-llms-txt";
import starlightTypeDoc from "starlight-typedoc";

const REPO_URL = "https://github.com/MantleJs/mantle";

/**
 * Serve the shadcn registry (`nx run ui-registry:build-registry` → `registry/public/r`) at `/r/`, keeping
 * its `{style}/{name}.json` layout (PRD Decision #19): `https://mantlejs.com/r/aria-nova/login-form.json`.
 */
function mantleRegistry() {
  const source = fileURLToPath(new URL("../registry/public/r", import.meta.url));
  return {
    name: "mantle-registry",
    hooks: {
      /** @param {{ dir: URL }} options */
      "astro:build:done": async ({ dir }) => {
        if (!existsSync(source)) {
          throw new Error(
            `Registry not built: ${source} is missing — run \`npx nx run ui-registry:build-registry\` first`,
          );
        }
        await cp(source, fileURLToPath(new URL("r", dir)), { recursive: true });
      },
    },
  };
}

export default defineConfig({
  site: "https://mantlejs.com",
  integrations: [
    starlight({
      title: "Mantle JS",
      description:
        "A layered, real-time TypeScript framework for web APIs — services as contracts, repositories for data access, one hook pipeline for every transport and every agent.",
      social: [{ icon: "github", label: "GitHub", href: REPO_URL }],
      editLink: { baseUrl: `${REPO_URL}/edit/main/website/` },
      customCss: ["./src/styles/global.css"],
      sidebar: [
        { label: "Start here", items: ["getting-started", "architecture"] },
        { label: "Guides", items: [{ autogenerate: { directory: "guides" } }] },
        {
          label: "UI blocks",
          // /blocks/ itself is registry/README.md (src/loaders/docs-with-readmes.ts).
          items: [{ label: "Overview", link: "/blocks/" }, { autogenerate: { directory: "blocks" } }],
        },
        { label: "Packages", collapsed: true, items: [{ autogenerate: { directory: "packages" } }] },
        // A single link rather than starlight-typedoc's generated group: that group lists every exported
        // symbol of all 40 packages, and Starlight inlines the sidebar into every page (~200 KB each).
        // /api/ lists the packages; each package page lists its members.
        { label: "API reference", link: "/api/" },
      ],
      plugins: [
        starlightTypeDoc({
          // One TypeDoc project per published package, each with its own tsconfig — module names come
          // from package.json ("@mantlejs/auth"), and the reference covers exactly what src/index.ts exports.
          entryPoints: ["../packages/*"],
          output: "api",
          typeDoc: {
            entryPointStrategy: "packages",
            packageOptions: {
              entryPoints: ["src/index.ts"],
              tsconfig: "tsconfig.lib.json",
              // The package README is its own page under /packages/ (src/loaders/docs-with-readmes.ts).
              readme: "none",
              skipErrorChecking: true,
              excludeExternals: true,
            },
            skipErrorChecking: true,
            // Package overview pages as `<pkg>/index.md` — starlight-typedoc drops nested `README.md`
            // pages when TypeDoc's `readme` option is off, which would orphan every package's member list.
            entryFileName: "index",
          },
        }),
        starlightLinksValidator(),
        starlightLlmsTxt({
          projectName: "Mantle JS",
          details:
            "Mantle is a TypeScript framework for web APIs in a layered (Clean/Onion) architecture: `Service<T>` is a contract, data access lives in `Repository<T>` adapters, and every transport (HTTP, Socket.IO, MCP) runs the same hook pipeline. Package names are `@mantlejs/*`.",
          demote: ["api/**"],
          exclude: ["api/**"],
        }),
      ],
    }),
    react(),
    mantleRegistry(),
  ],
  vite: {
    plugins: [tailwindcss()],
    // Build-time components that read repo files (RepoTable) resolve against this — a component's own
    // import.meta.url points into the bundled output, not the source tree.
    define: { "import.meta.env.MANTLE_REPO_ROOT": JSON.stringify(fileURLToPath(new URL("../", import.meta.url))) },
    resolve: {
      // Block demos import the registry's own sources, which use its `@/` alias (components.json).
      alias: { "@": fileURLToPath(new URL("../registry/src", import.meta.url)) },
    },
  },
});
