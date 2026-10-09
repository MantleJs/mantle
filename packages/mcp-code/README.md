# @mantlejs/mcp-code

MCP **code mode** for [Mantle JS](https://github.com/mantlejs/mantle). Instead of one MCP tool per service method, the agent gets a typed TypeScript API of your exposed services and writes a short script against it. The script runs in a QuickJS sandbox. Many service calls happen in one round trip, filtering and joining happen in code, and only the final answer goes back to the model.

Every `mantle.<path>.<method>()` call inside a script runs the service's **full hook pipeline** as the MCP session — `authenticate`, `authorizeAgent()`, validation, `@mantlejs/audit` — exactly like [`@mantlejs/mcp`](../mcp/README.md)'s per-method tools. Code mode changes how the agent calls your API, not what it's allowed to do.

> **Experimental.** Ships in the `experimental` release group (`0.2.0-experimental`); the API may change before it's promoted.

## Installation

```bash
npm install @mantlejs/mcp @mantlejs/mcp-code
```

`@mantlejs/mantle` and `@mantlejs/mcp` are peer dependencies. Requires Node ≥ 22 (TypeScript input needs ≥ 22.13 — see [TypeScript input](#typescript-input)).

---

## Quick start

```typescript
import { mantle, RepositoryService } from "@mantlejs/mantle";
import { express } from "@mantlejs/express";
import { mcp } from "@mantlejs/mcp";
import { codeMode } from "@mantlejs/mcp-code";

const app = mantle()
  .configure(express())
  .configure(
    mcp({
      transport: "http",
      services: { articles: ["find", "get"], comments: ["find"] }, // deny-by-default, as always
      codeMode: codeMode(),
    }),
  );

app.use("articles", new RepositoryService(new ArticleRepository(app)), { schema: articleSchema });
app.use("comments", new RepositoryService(new CommentRepository(app)), { schema: commentSchema });
app.listen(3030);
```

With a `codeMode` provider, `mcp()` defaults to `mode: "code"`:

| `mode`    | What the agent sees                                                        |
| --------- | -------------------------------------------------------------------------- |
| `"code"`  | `search_api` + `execute` + the `mantle://code/api.d.ts` resource (default) |
| `"both"`  | The above plus the per-method tools (`articles_find`, …)                   |
| `"tools"` | Per-method tools only — the provider isn't used                            |

App-authored `tools`, `resources`, `prompts`, and event resources are registered in every mode.

---

## What the agent sees

### `search_api({ query?, paths? })`

Loads the typed API a piece at a time. With no arguments it returns a one-line index (`articles — find, get`); `query` keyword-matches service paths, method names, and descriptions; `paths` selects exact services. The result is a self-contained TypeScript declaration module:

```typescript
type Id = string | number;
interface Paginated<T> {
  total: number;
  limit: number;
  skip: number;
  data: T[];
}

/** A `articles` record. */
type ArticlesRecord = { id?: string; title: string; tags: string[]; status: "draft" | "published" };
/** Query for `mantle.articles.find()`. */
type ArticlesQuery = {
  where?: { $or?: { [key: string]: unknown }[] } & { [key: string]: unknown | { $lt?: unknown; $like?: unknown } };
  /** Maximum records to return. Default 25; requests above 100 are clamped. Page with skip. */
  limit?: number;
  skip?: number;
  sort?: { [key: string]: "asc" | "desc" };
  select?: string[];
};

declare const mantle: {
  articles: {
    /** Find articles records matching a query. Results are paginated — … */
    find(query?: ArticlesQuery): Promise<ArticlesRecord[] | Paginated<ArticlesRecord>>;
    /** Get a single articles record by id. */
    get(id: Id, query?: ArticlesIdQuery): Promise<ArticlesRecord>;
  };
};
```

The same module (for the session) is served as the **`mantle://code/api.d.ts`** resource, for clients that load resources up front.

- **One source of truth.** Every parameter and return type is converted from the exact JSON Schema `@mantlejs/mcp` lists the per-method tool with (`describeServiceMethod()`), so code mode and tool mode can't drift. Record types come from the schema attached in `app.use()`; services without one get `{ [key: string]: unknown }`.
- **Operators match the adapter.** The `where` type offers exactly the operators the repository's `describe().capabilities.operators` reports.
- **Paths are keys, verbatim.** `mantle.articles`, `mantle["blog-posts"]`, `mantle["admin/reports"]` — no aliasing, so there's never a collision or a renamed path to guess.
- **Signatures:** `find(query?)`, `get(id, query?)`, `remove(id, query?)`, `create(data)`, `update(id, data)`, `patch(id, data)`, custom methods `(data?)` — the same argument objects tool mode takes, positionally.

### `execute({ code })`

Runs a script — the **body of an async function**: top-level `await` works and `return` sends back the result.

```javascript
const { data } = await mantle.articles.find({ where: { status: "published" }, limit: 100, select: ["id", "tags"] });
const counts = {};
for (const article of data) for (const tag of article.tags) counts[tag] = (counts[tag] ?? 0) + 1;
console.log("articles scanned:", data.length);
return counts;
```

returns

```json
{ "result": { "guide": 2, "start": 1 }, "executionId": "…", "calls": 1, "logs": ["[log] articles scanned: 2"] }
```

plus `notes` when something was cut short (a partial `find` page, dropped log lines).

- **Values cross as JSON** in both directions — `Date` becomes an ISO string, functions and `undefined` are dropped.
- **Run independent calls with `Promise.all`** — bridged calls run concurrently.
- **Service errors are catchable.** A rejected call throws an `Error` carrying the service error's `name`, `message`, `code`, `className`, `data`, and `hint`:

  ```javascript
  try {
    return await mantle.articles.get(id);
  } catch (e) {
    if (e.name === "NotFound") return null;
    throw e;
  }
  ```

- **Uncaught errors** come back as an MCP tool error with the same `MantleError.toJSON()` shape tool mode uses. A service error keeps its class (`NotFound`, `Forbidden`, …); the script's own bugs (a `TypeError`, a syntax error) are `CodeScriptError`. `data.execution` carries `{ executionId, calls, logs }`, and the original `data`, if any, moves to `data.cause`.

---

## Limits

Every execution gets a **fresh sandbox** — nothing carries over between calls — and every limit fails with a typed error. None can take down the host process.

| Limit             | Default | Error                      | Enforcement                                                                                      |
| ----------------- | ------- | -------------------------- | ------------------------------------------------------------------------------------------------ |
| `timeoutMs`       | 10 000  | `CodeTimeout` (408)        | Interrupt handler for CPU loops **and** a host timer for a bridged call that never settles       |
| `memoryBytes`     | 32 MiB  | `CodeLimitExceeded` (422)  | QuickJS's own limit — soft, it undercounts some allocations                                      |
| `wasmMemoryBytes` | 64 MiB  | `CodeLimitExceeded` (422)  | Bounded `WebAssembly.Memory` per execution — the hard cap. Minimum 16 MiB                        |
| `stackBytes`      | 192 KiB | `CodeLimitExceeded` (422)  | QuickJS shares the host thread's stack — keep it under ~¼ of it (~256 KiB on Node's main thread) |
| `maxCalls`        | 50      | `CodeLimitExceeded` (422)  | Bridged calls per execution. Fails the execution even if the script catches the error            |
| `maxOutputBytes`  | 64 KiB  | `CodeOutputTooLarge` (413) | JSON result size; log output past it is dropped with a note                                      |

```typescript
codeMode({ limits: { timeoutMs: 5_000, maxCalls: 20 } });
```

A stack limit above the safe ceiling can overflow the host's native stack; that's contained as `CodeExecutorFault` (500) and the sandbox instance is discarded. A bridged service call already in flight when a timeout fires runs to completion on the host — it can't be cancelled — but its result is discarded.

---

## TypeScript input

On Node ≥ 22.13 the script may use TypeScript annotations — types are stripped host-side with `module.stripTypeScriptTypes` (positions preserved, so error line numbers match the script). Only erasable syntax is supported: `enum` and `namespace` fail with a `BadRequest` and a hint. Agent code is not type-checked. On older Node versions scripts must be plain JavaScript, and the `execute` description says so. Node prints a one-time `ExperimentalWarning` the first time the stripper runs.

---

## Security model

- **The hook pipeline is the authority.** Each bridged call is `createServiceMethodRunner()` from `@mantlejs/mcp` — the identical path tool mode uses — with the session's params, `provider: "mcp"`, the session's `authorization` header, and fresh params per call. Hooks see the same request either way; `HookContext.provider` is `"mcp"` for both.
- **The expose map is the hard boundary.** Only the exposed methods exist inside the sandbox. A registered-but-unexposed service or method isn't there to call.
- **Agent narrowing is display only.** When the session authenticated with an [agent token](../auth/README.md#agent-tokens), `search_api` and the resource show only the methods its capability scope grants. Enforcement stays in `authorizeAgent()`: an exposed-but-out-of-scope call still reaches the hook and throws a catchable `Forbidden` — the same denial tool mode returns.
- **No ambient capabilities.** No `fetch`, `XMLHttpRequest`, `WebSocket`, `require`/`import`, `process`, filesystem, or timers; the guest holds no host object references. `Date` and `Math.random` behave normally.
- **Every call is attributable.** Each bridged call carries `params.mcp = { mode: "code", executionId, scriptHash }`. With [`@mantlejs/audit`](../audit/README.md), a script that made N calls produces N audit records sharing the `executionId`. The script source itself is recorded only with `codeMode({ auditScriptSource: true })` — off by default, since scripts can embed data; the SHA-256 `scriptHash` is always there to match a record to a script.

---

## Custom executors

The sandbox is pluggable. Implement `CodeExecutor`:

```typescript
interface CodeExecutor {
  execute(code: string, bridge: CodeBridge, limits: CodeLimits): Promise<CodeExecutionResult>;
}

codeMode({ executor: myWorkerExecutor() });
```

The contract — fresh state per execution, JSON-only values, the `mantle` API built from `bridge.services`, no host capabilities, every limit typed, never rejecting — is published as data, so any executor can run the reference suite:

```typescript
import { CODE_EXECUTOR_CONFORMANCE_CASES, conformanceBridge, DEFAULT_CODE_LIMITS } from "@mantlejs/mcp-code";

for (const testCase of CODE_EXECUTOR_CONFORMANCE_CASES) {
  it(testCase.name, async () => {
    const bridge = conformanceBridge();
    const result = await myExecutor.execute(testCase.code, bridge, { ...DEFAULT_CODE_LIMITS, ...testCase.limits });
    // compare with testCase.expect and testCase.check — see quickjs-executor.spec.ts for the full loop
  });
}
```

---

## When to prefer tool mode

- **Small APIs** — a handful of methods costs little context as tools.
- **Clients that don't write code well** — some models are much better at choosing a tool than at writing a correct script.
- **Interactive, one-call-at-a-time work** where intermediate results should be shown to the user anyway.

`mode: "both"` serves both surfaces from one endpoint, or mount two `mcp()` endpoints with different `path`s (see the [knowledge-base example](../../examples/knowledge-base/README.md#mcp-code-mode)).

---

## API

| Export                                                                                           | Description                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `codeMode(options?)`                                                                             | The `McpCodeModeProvider` for `mcp({ codeMode })`. Options: `executor`, `limits`, `auditScriptSource`                                                                                     |
| `quickJsExecutor()`                                                                              | The default `CodeExecutor` (QuickJS sync WASM build, fresh bounded instance per execution)                                                                                                |
| `DEFAULT_CODE_LIMITS`, `MIN_WASM_MEMORY_BYTES`                                                   | Limit defaults and the `wasmMemoryBytes` floor                                                                                                                                            |
| `CodeTimeout`, `CodeLimitExceeded`, `CodeOutputTooLarge`, `CodeScriptError`, `CodeExecutorFault` | Typed errors (`MantleError` subclasses)                                                                                                                                                   |
| `CODE_EXECUTOR_CONFORMANCE_CASES`, `conformanceBridge()`                                         | The executor contract as data                                                                                                                                                             |
| `API_RESOURCE_URI`                                                                               | `"mantle://code/api.d.ts"`                                                                                                                                                                |
| Types                                                                                            | `CodeModeOptions`, `CodeModeCallMetadata`, `CodeExecutionReport`, `CodeExecutor`, `CodeBridge`, `CodeLimits`, `CodeExecutionResult`, `ConformanceCase`, `ConformanceBridge`, `BridgeCall` |
