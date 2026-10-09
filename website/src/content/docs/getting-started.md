---
title: Getting started
description: Scaffold a Mantle app with npm create, or write the smallest possible one by hand — one service, one file, no external infrastructure.
---

Mantle needs **Node.js 22 or newer**. Every package is published under the `@mantlejs` scope.

## Scaffold a project

`create-mantlejs` generates a complete app — transport, database adapter, auth strategy, and a first service —
and installs it:

```bash
npm create mantlejs@latest my-app
```

It prompts for a database (`pg`, `sqlite`, `mongodb`, or none), an auth strategy (`local` or one of the OAuth
providers), and a package manager. Pass flags after `--` to skip the prompts:

```bash
npm create mantlejs@latest my-app -- --database pg --auth local --package-manager npm
cd my-app
npm run dev
```

See [`create-mantlejs`](/packages/create-mantlejs/) and [`@mantlejs/cli`](/packages/cli/) for every option
and for generating services, repositories, and hooks inside an existing project.

## Or write one by hand

The smallest runnable Mantle app is one service over an in-memory repository, served by the zero-dependency HTTP
transport. This is the whole of `examples/todo-minimal`:

```bash
npm install @mantlejs/mantle @mantlejs/http @mantlejs/memory
```

```typescript
// src/index.ts
import { mantle, RepositoryService } from "@mantlejs/mantle";
import { http } from "@mantlejs/http";
import { MemoryRepository } from "@mantlejs/memory";

interface Todo extends Record<string, unknown> {
  id: string;
  title: string;
  done: boolean;
}

const app = mantle().configure(http({ cors: true }));

app.use("todos", new RepositoryService<Todo>(new MemoryRepository<Todo>()), {
  methods: ["find", "get", "create", "update", "patch", "remove"],
});

app.listen(3000, () => console.log("listening on http://localhost:3000"));
```

Three pieces, one per layer:

- **`MemoryRepository<Todo>`** is the data access — a `Repository<T>` implementation. Swap it for
  `KnexRepository`, `MongoRepository`, `DynamoDbRepository`, … without touching anything else.
- **`RepositoryService`** is the service — the `Service<T>` contract (`find`, `get`, `create`, `update`,
  `patch`, `remove`) over one repository, with query-string parsing, pagination, and typed errors built in.
- **`http()`** is the transport — it maps `GET /todos`, `POST /todos`, `PATCH /todos/:id`, … onto the service.

Try it:

```bash
curl -X POST http://localhost:3000/todos -H 'content-type: application/json' \
  -d '{"title": "write the README", "done": false}'

curl 'http://localhost:3000/todos?$sort[title]=asc&$limit=10'
```

`find` always answers with a `Paginated<T>` envelope — `{ "total": 1, "limit": 10, "skip": 0, "data": [ … ] }` —
and the query string maps onto the repository's `where`/`sort`/`limit`/`skip`/`select`
([query conventions](/packages/mantle/#query-conventions)). Query values arrive as strings; attach a schema to the
service (`new RepositoryService(repo, { schema })`) to have them coerced to numbers and booleans.

## Add behavior with hooks

Cross-cutting behavior — authentication, validation, logging, auditing — goes in **hooks**: plain functions that
run before, after, or on error of a service method, for every transport alike.

```typescript
import { BadRequest, type HookContext } from "@mantlejs/mantle";

const requireTitle = (context: HookContext) => {
  const title = (context.data as { title?: unknown } | undefined)?.title;
  if (typeof title !== "string" || title.trim() === "") {
    throw new BadRequest("A todo needs a title", undefined, undefined, "Send a non-empty string in `title`.");
  }
  return context;
};

app.service("todos").hooks({
  before: { create: [requireTitle] },
});
```

Errors are always typed (`BadRequest`, `NotFound`, `Forbidden`, …) and serialize to JSON with an optional
`hint` telling the caller — a person or an agent — how to fix the request.

## Call it from a frontend

```typescript
import { mantle } from "@mantlejs/client";

const api = mantle({ url: "http://localhost:3000" });
const todos = api.service<Todo>("todos");

const todo = await todos.create({ title: "ship it", done: false });
await todos.patch(todo.id, { done: true });
const page = await todos.find({ query: { $sort: { title: "asc" }, $limit: 10 } });
```

In React, [`@mantlejs/react`](/packages/react/) wraps the client in TanStack Query hooks, and the
[UI blocks](/blocks/) give you ready-made auth forms, tables, lists, and uploads on top of them.

## Next steps

- [Architecture](/architecture/) — the layers, the dependency rule, and how Mantle differs from FeathersJS.
- [Adapters](/guides/adapters/) — databases, vector stores, and which query operators each supports.
- [Authentication](/guides/auth/) — JWTs, local and OAuth sign-in, refresh-token rotation.
- [Agents](/guides/agents/) — exposing services to AI agents over MCP, scoped agent tokens, and an audit trail.
- [`examples/knowledge-base`](https://github.com/MantleJs/mantle/tree/main/examples/knowledge-base) — the
  canonical example, with nearly every package wired into one app.
