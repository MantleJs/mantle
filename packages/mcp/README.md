# @mantlejs/mcp

Expose Mantle services as [Model Context Protocol](https://modelcontextprotocol.io) tools — an AI agent gets one tool per exposed service method, with input schemas derived from your TypeBox schemas and query capabilities, and every call runs the service's **full hook pipeline**. There is no bypass: authentication, validation, and events apply to agents exactly as they do to REST callers.

## Installation

```bash
npm install @mantlejs/mcp
```

`@mantlejs/mantle` is a peer dependency. For `transport: "http"`, an HTTP transport (`@mantlejs/express`, `@mantlejs/koa`, or `@mantlejs/http`) must be configured first.

---

## Concepts

### Deny-by-default expose map

Nothing is exposed unless you say so. `services` is required and maps a service path to the methods that become tools:

```typescript
mcp({
  transport: "http",
  services: {
    articles: true,            // every method registered in app.use()
    users: ["find", "get"],    // read-only over MCP
  },
});
```

- `true` exposes all of the service's registered methods — never more than `app.use()` registered.
- An unknown path or method fails the boot (`listen()` / `startMcp()`) with a `BadRequest` naming it.
- `services: "*"` exposes every service registered **after** `mcp()` — a deliberate, greppable escape hatch for prototyping.
- With `events: true`, only expose-map services get an event resource; hidden services never leak.

### One tool per method

Tools are generated from `ServiceHandle.describe()` and named `{path}_{method}` (`users_find`, `blog_posts_create`, custom methods included):

- **`find`** takes a structured `query` (`where` / `limit` / `skip` / `sort` / `select`). The `where` operator set is constrained to the adapter's `describe().capabilities.operators` — an agent is never offered `$ilike` against an adapter that rejects it.
- **`create`/`update`/`patch`** take `data` typed by the schema attached in `app.use()` (`patch` gets the all-optional variant); services without a schema still get tools with a generic object schema.
- **`get`/`remove`** take `id`; `update`/`remove` descriptions carry destructive-operation notes.

### Hook-pipeline dispatch

Every tool call goes through `service.dispatch()` — the same entry point the HTTP transports use — with `params.provider = "mcp"`. Hooks can therefore apply agent-specific policy:

```typescript
app.service("articles").hooks({
  before: {
    remove: [
      (ctx) => {
        if (ctx.params.provider === "mcp") throw new Forbidden("Agents may not delete articles");
        return ctx;
      },
    ],
  },
});
```

Errors come back as MCP **tool errors** carrying `MantleError.toJSON()` — name, message, code, `data`, and `hint` — so an agent can read what went wrong and adjust.

### Result limits

`find` results are clamped: `limit = min(requested ?? defaultLimit, maxLimit)` (defaults 25 / 100, configurable via `query`). The clamp is advertised in the generated schema (`maximum`, default in the description), and a truncated page carries a note telling the agent to page with `skip`/`limit` and trim fields with `select`.

### Authentication

- **HTTP:** a `Bearer` token on the request is verified with the configured auth engine (`@mantlejs/auth`); the resolved user lands on `params.user` for every call in the session, and the `authorization` header is passed through so `authenticate("jwt")` hooks work unchanged. No/invalid token → the session is anonymous and each service's own auth hooks reject. The MCP layer makes no auth decisions of its own.
- **stdio:** carries no HTTP request — pass `startMcp(app, { params: { headers: { authorization: "Bearer …" } } })` to authenticate the session, otherwise it is anonymous.

---

## Quick start

### HTTP

```typescript
import { mantle, RepositoryService } from "@mantlejs/mantle";
import { express } from "@mantlejs/express";
import { mcp } from "@mantlejs/mcp";

const app = mantle()
  .configure(express())
  .configure(
    mcp({
      transport: "http",           // mounts POST /mcp (path configurable)
      services: { users: ["find", "get"], articles: true },
      events: true,                // mantle://events/{path} resources
    }),
  );

app.use("users", new RepositoryService(new UserRepository(app)), { schema: userSchema });
app.listen(3030);
```

Point an MCP client at `http://localhost:3030/mcp` (streamable HTTP, JSON responses; SSE streaming is not supported — poll event resources instead).

### stdio

```typescript
// mcp.ts — separate entry point: build the app, don't listen()
import { startMcp } from "@mantlejs/mcp";
import { buildApp } from "./app.js";

const app = buildApp(); // configure(mcp({ transport: "stdio", services: { … } }))
await startMcp(app);
```

### Custom (composite) tools

Task-level tools beyond CRUD — chain service calls with the session's identity; every inner `dispatch` runs the target's hook pipeline:

```typescript
mcp({
  transport: "http",
  services: { articles: ["find", "get"] },
  tools: [
    {
      name: "publish_article",
      description: "Publish an article and record the activity.",
      inputSchema: { type: "object", required: ["articleId"], properties: { articleId: { type: "string" } } },
      handler: async (args, { app, params }) => {
        const { articleId } = args as { articleId: string };
        const article = await app.service("articles").dispatch("patch", { status: "published" }, articleId, params);
        await app.service("activity").dispatch("create", { type: "published", articleId }, undefined, params);
        return article;
      },
    },
  ],
});
```

A custom tool name colliding with a generated tool fails the boot.

### Custom resources

Read-only reference content an agent should load as context rather than query as a tool — schema docs, enum values, usage guides. `read` receives the same session context as tools, so inner `dispatch()` calls run the full hook pipeline:

```typescript
mcp({
  transport: "http",
  services: { users: ["find"] },
  resources: [
    {
      uri: "mantle://docs/usage",
      name: "API usage guide",
      mimeType: "text/markdown",
      read: async () => readFile("docs/agent-guide.md", "utf8"),
    },
  ],
});
```

The `mantle://events/` namespace is reserved for event resources; duplicate or reserved URIs fail at configure time. Custom resources have no update signal — subscribing is an accepted no-op (event resources keep live notifications on stdio).

### Prompts

Prompt templates that MCP clients surface as user-invokable commands (e.g. slash commands). `get` may return a plain string (shorthand for a single user message) or the full `{ description?, messages }` shape, and receives the session context:

```typescript
mcp({
  transport: "http",
  services: { articles: ["find"] },
  prompts: [
    {
      name: "triage_articles",
      description: "Review articles awaiting moderation.",
      arguments: [{ name: "focus", required: false }],
      get: async (args, { app, params }) => {
        const page = await app.service("articles").dispatch("find", undefined, undefined, {
          ...params,
          query: { status: "pending", $limit: 10 },
        });
        return `Review these pending articles${args["focus"] ? ` (focus: ${args["focus"]})` : ""}: ${JSON.stringify(page)}`;
      },
    },
  ],
});
```

The `prompts` capability is only declared when at least one prompt is defined; duplicate names fail at configure time.

---

## API

### `mcp(options: McpOptions): MantlePlugin`

| Option       | Type                                     | Default                                | Description                                                                 |
| ------------ | ---------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------- |
| `services`   | `Record<string, string[] \| true> \| "*"` | — (required)                           | Deny-by-default expose map.                                                 |
| `transport`  | `"stdio" \| "http"`                      | — (required)                           | `"http"` mounts on the app's transport; `"stdio"` pairs with `startMcp()`.  |
| `path`       | `string`                                 | `"/mcp"`                               | HTTP mount path.                                                            |
| `serverInfo` | `{ name?, version? }`                    | `{ name: "mantle", version: "0.0.0" }` | Identity reported during MCP initialization.                                |
| `events`     | `boolean`                                | `false`                                | Event resources (`mantle://events/{path}`, last 50 events) for exposed services. |
| `tools`      | `McpToolDefinition[]`                    | `[]`                                   | App-authored composite tools.                                               |
| `resources`  | `McpResourceDefinition[]`                | `[]`                                   | App-authored read-only resources.                                           |
| `prompts`    | `McpPromptDefinition[]`                  | `[]`                                   | App-authored prompt templates.                                              |
| `query`      | `{ defaultLimit?, maxLimit? }`           | `{ defaultLimit: 25, maxLimit: 100 }`  | `find` result guardrails.                                                   |

### `startMcp(app, options?): Promise<Server>`

Connects the configured server to stdio. `options.params` merges extra `ServiceParams` (e.g. an `authorization` header) into every call of the session.

There is deliberately **no batch tool** — agents issue parallel tool calls natively, and composite needs are served by `tools`.

## Configure order

`mcp()` reads the `"http:router"` contract and (for `"*"`) tracks registrations, so configure it **after** the HTTP transport and **before** registering services.
