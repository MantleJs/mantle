---
title: Agents (MCP)
description: Expose services to AI agents over the Model Context Protocol — per-method tools or code mode — with scoped agent tokens and an audit trail, all through the same hook pipeline as every other caller.
sidebar:
  order: 3
---

Mantle treats an AI agent as one more transport. An agent connects over the
[Model Context Protocol](https://modelcontextprotocol.io), and every call it makes runs the target service's
**full hook pipeline** — authentication, validation, events, auditing — exactly like a REST call. There is no
agent-only path that skips your rules; specs assert that HTTP, MCP tool mode, and MCP code mode make identical
accept/reject decisions for the same hook chain.

Four pieces work together:

| Piece                                            | What it does                                                                      |
| ------------------------------------------------ | --------------------------------------------------------------------------------- |
| [`@mantlejs/mcp`](/packages/mcp/)                | An MCP server over your services: deny-by-default expose map, one tool per method |
| [`@mantlejs/mcp-code`](/packages/mcp-code/)      | **Code mode**: a typed API the agent writes scripts against, run in a sandbox     |
| [`@mantlejs/auth`](/packages/auth/#agent-tokens) | Agent tokens — short-lived, capability-scoped, revocable, delegated by a user     |
| [`@mantlejs/audit`](/packages/audit/)            | An audit-trail hook: who did what, as which identity, into any `Repository<T>`    |

## Tool mode

```typescript
import { mcp } from "@mantlejs/mcp";

app.configure(
  mcp({
    transport: "http", // mounts POST /mcp on the app's HTTP transport; or "stdio" via startMcp(app)
    services: {
      articles: true, // every method registered in app.use()
      users: ["find", "get"], // read-only over MCP
    },
  }),
);
```

Nothing is exposed unless the expose map says so; an unknown path or method fails at startup. Each exposed
method becomes a tool (`articles_find`, `users_get`, …) whose input schema comes from the service's schema and its
adapter's `describe().capabilities` — an agent is never offered a query operator the adapter would reject. Errors
come back as MCP tool errors carrying `MantleError.toJSON()`, `hint` included, so the agent can correct itself.

## Code mode

With many methods, one tool per method crowds the model's context, and every intermediate result round-trips
through the model. **Code mode** replaces the per-method tools with a typed TypeScript API and two tools:

- `search_api` returns the declarations for the services the agent needs, a piece at a time;
- `execute` runs a script against them in a QuickJS sandbox and returns only the final result.

```typescript
import { mcp } from "@mantlejs/mcp";
import { codeMode } from "@mantlejs/mcp-code";

app.configure(
  mcp({
    transport: "http",
    services: { articles: ["find", "get"], comments: ["find"] },
    codeMode: codeMode(), // mode defaults to "code"; "both" keeps the per-method tools too
  }),
);
```

An agent's script:

```javascript
const { data } = await mantle.articles.find({ where: { status: "published" }, limit: 100, select: ["id", "tags"] });
const counts = {};
for (const article of data) for (const tag of article.tags) counts[tag] = (counts[tag] ?? 0) + 1;
return counts;
```

Each `mantle.<path>.<method>()` call is a real service call through the hook pipeline. The sandbox has no network,
filesystem, `process`, or timers; every execution starts fresh; and time, memory, stack, call count, and output
size are all capped with typed errors. Code mode is **experimental** — see the
[package page](/packages/mcp-code/) for limits, TypeScript input, the security model, and custom executors.

## Agent tokens

A user delegates a slice of their access to an agent with a scoped token:

```typescript
import type { AuthEngine } from "@mantlejs/auth";

const engine = app.get<AuthEngine>("auth");
const issued = await engine.issueAgentToken(
  { articles: ["find", "get"], comments: true }, // CapabilityScope: methods per path, or true for all
  user.id, // the delegating user
  { expiresIn: "15m" },
);
// later, before it expires if needed:
await engine.revokeAgentToken(issued.id);
```

Routes opt in with the `authorizeAgent()` hook. It checks the token's scope against the call's path and method —
the same deny-by-default matcher as the MCP expose map — and sets `context.agent = { id, scope, delegatingUserId }`
for downstream hooks:

```typescript
import { authorizeAgent } from "@mantlejs/auth";

app.service("articles").hooks({ before: { all: [authorizeAgent()] } });
```

Agent tokens can't be used as user JWTs: `authenticate("jwt")` rejects them outright, so a route without
`authorizeAgent()` is unreachable with an agent token whatever its scope. In code mode, an agent session's API
listing is narrowed to its scope, and an out-of-scope call still fails in `authorizeAgent()` with the same
catchable `Forbidden` tool mode returns.

## The audit trail

```typescript
import { auditLog, type AuditRecord } from "@mantlejs/audit";

const audit = auditLog({ sink: new AuditRepository(app) }); // any Repository<AuditRecord>

app.service("articles").hooks({
  after: { all: [audit] },
  error: { all: [audit] },
});
```

Each call becomes a record — principal, agent id and scope when an agent made it, path, method, outcome — in a
repository you choose, so "what did my agents do?" is a `find()` away. Calls from a code-mode script also carry
the script's `executionId` and a SHA-256 `scriptHash`, grouping a script's calls together. A failed audit write is
logged, never allowed to fail the call it records.
