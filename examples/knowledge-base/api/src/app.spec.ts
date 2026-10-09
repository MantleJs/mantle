import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
// Side-effect import: pulls in @mantlejs/express's `declare module` augmentation of
// `MantleApplication.listen` for this file's own compilation unit.
import "@mantlejs/express";
import type { MantleApplication } from "@mantlejs/mantle";
import { createApp } from "./app.js";

// A syntactically valid connection string that Knex will never actually connect to —
// these specs only exercise routes that don't touch the database (OAuth redirects,
// auth rejection before a handler runs, OpenAPI/MCP metadata endpoints), so a live
// Postgres isn't required.
const UNREACHABLE_DB = "postgres://invalid:invalid@127.0.0.1:1/nope";

const ORIGINAL_ENV = { ...process.env };

async function withServer(fn: (baseUrl: string, app: MantleApplication) => Promise<void>): Promise<void> {
  const app = createApp({ databaseUrl: UNREACHABLE_DB });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
  try {
    await fn(baseUrl, app);
  } finally {
    server.close();
  }
}

describe("knowledge-base-api bootstrap", () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("boots without a live database connection", () => {
    expect(() => createApp({ databaseUrl: UNREACHABLE_DB })).not.toThrow();
  });

  it("does not mount an OAuth provider route when its credentials are absent", async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/auth/google`, { redirect: "manual" });
      expect(res.status).toBe(404);
    });
  });

  it("mounts an OAuth provider route once its credentials are present", async () => {
    process.env.GOOGLE_CLIENT_ID = "test-client-id";
    process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/auth/google`, { redirect: "manual" });
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toContain("accounts.google.com");
    });
  });

  it("rejects an unauthenticated request to a protected users method", async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/users`);
      expect(res.status).toBe(401);
    });
  });

  it("serves an OpenAPI document listing the registered services", async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/openapi.json`);
      expect(res.status).toBe(200);
      const doc = (await res.json()) as { paths?: Record<string, unknown> };
      expect(Object.keys(doc.paths ?? {}).some((path) => path.includes("articles"))).toBe(true);
    });
  });

  it("serves the Swagger UI page", async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/docs`);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("swagger-ui");
    });
  });

  it("lists MCP tools for the exposed services only", async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { result?: { tools?: Array<{ name: string }> } };
      const names = (body.result?.tools ?? []).map((t) => t.name);
      expect(names).toContain("articles_find");
      expect(names).toContain("search_similar");
      expect(names.some((n) => n.startsWith("users_"))).toBe(false);
    });
  });

  it("serves MCP code mode at /mcp-code: two tools, a typed API, and a working sandbox", async () => {
    await withServer(async (baseUrl) => {
      const rpc = async (method: string, params: Record<string, unknown>) => {
        const res = await fetch(`${baseUrl}/mcp-code`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        });
        expect(res.status).toBe(200);
        return (await res.json()) as {
          result?: { tools?: Array<{ name: string }>; content?: Array<{ text: string }>; isError?: boolean };
        };
      };

      const listed = await rpc("tools/list", {});
      expect((listed.result?.tools ?? []).map((t) => t.name).sort()).toEqual(["execute", "search_api"]);

      const index = await rpc("tools/call", { name: "search_api", arguments: {} });
      const text = JSON.parse(index.result?.content?.[0]?.text ?? '""') as string;
      expect(text).toContain("articles — find, get");
      expect(text).not.toContain("users");

      // No database here — a script that doesn't touch a service still proves the sandbox runs.
      const code = "return [1, 2, 3].map((n) => n * 2);";
      const run = await rpc("tools/call", { name: "execute", arguments: { code } });
      expect(run.result?.isError).toBeUndefined();
      expect(JSON.parse(run.result?.content?.[0]?.text ?? "{}")).toMatchObject({ result: [2, 4, 6], calls: 0 });
    });
  });
});
