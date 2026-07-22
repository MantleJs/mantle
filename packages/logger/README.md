# @mantlejs/logger

Structured logging plugin for [Mantle JS](https://github.com/mantlejs/mantle). Provides a pino adapter and two hook factories — `logRequest` and `logError` — that emit structured JSON records through any logger satisfying the Mantle `Logger` interface.

---

## Installation

```bash
npm install @mantlejs/logger pino
```

`pino` is an optional peer dependency, loaded lazily by `createLogger()`. If you prefer winston, LogLayer, or another logger, skip it — see [Using a different logger](#using-a-different-logger). To pretty-print in development, also install `pino-pretty` (also optional — see [`createLogger(options?)`](#createloggeroptions)).

---

## Concepts

### The Logger interface

`@mantlejs/mantle` defines a minimal `Logger` interface with four methods: `debug`, `info`, `warn`, and `error`. Every method accepts a message string and an optional context object:

```typescript
interface Logger {
  debug(msg: string, context?: Record<string, unknown>): void;
  info(msg: string, context?: Record<string, unknown>): void;
  warn(msg: string, context?: Record<string, unknown>): void;
  error(msg: string, context?: Record<string, unknown>): void;
}
```

Any object with these four methods can be registered on the app. Mantle packages emit logs via `app.get('logger')?.debug(...)` — if no logger is configured, all internal logging is silently skipped.

### LOG_LEVEL

Verbosity is controlled by the `LOG_LEVEL` environment variable, not a `DEBUG=*` namespace. Set it before starting your process:

```bash
LOG_LEVEL=debug npm start   # debug + info + warn + error
LOG_LEVEL=info npm start    # info + warn + error  (recommended for production)
LOG_LEVEL=warn npm start    # warn + error only
```

### Component field

All records emitted by Mantle packages include a `component` field (`mantle:core`, `mantle:knex`, `mantle:request`, `mantle:error`, etc.). Use this field in your log aggregation tool (CloudWatch, Datadog, Grafana Loki) to filter framework-internal logs without restarting the process.

### Correlation ID

When you use `pinoAdapter` with the `express()` transport, every log record emitted during a request automatically includes a `correlationId` field. No manual threading required.

The `express()` plugin reads the `X-Correlation-ID` request header (or generates a UUID) and stores it in `@mantlejs/mantle`'s `AsyncLocalStorage` context via `withContext`. `pinoAdapter` calls `getContext()` on every log call and merges the result into the pino object.

```json
{
  "correlationId": "a3f2c1d4-8b2e-4f1a-9c3d-1e2f3a4b5c6d",
  "component": "mantle:request",
  "method": "create",
  "path": "users",
  "provider": "rest",
  "durationMs": 12,
  "status": "ok"
}
```

The `X-Correlation-ID` is echoed back in the response header so callers can correlate their requests with server-side log entries.

Hooks and other code can read the correlation ID directly:

```typescript
import { getContext } from "@mantlejs/mantle";

const hook = (ctx) => {
  const { correlationId } = getContext() ?? {};
  // ...
  return ctx;
};
```

### Output destination

Destination is configured on the pino instance, not by Mantle. Common patterns:

```typescript
// stdout only — cloud-native default, recommended for EKS / Cloud Run
pino({ level: 'info' })

// file only
pino({}, pino.destination('/var/log/app.log'))

// stdout + file simultaneously
pino({ level: 'info' }, pino.multistream([
  { stream: process.stdout },
  { stream: pino.destination('/var/log/app.log') },
]))
```

> **Log rotation is not the application's concern.** In containers, the kubelet and log agent (fluentd, fluent-bit) collect from stdout. If writing to files, use `logrotate` or a sidecar shipper.

---

## Quick start

```typescript
import { mantle } from "@mantlejs/mantle";
import { express } from "@mantlejs/express";
import { logger, createLogger, logRequest, logError } from "@mantlejs/logger";

const app = mantle()
  .configure(express())
  .configure(logger(await createLogger({ gcp: process.env.NODE_ENV === "production" })));

const requestLogger = logRequest();

app.use("/users", new UserService(new UserRepository(app)));

app.service("users").hooks({
  before: { all: [requestLogger] },
  after:  { all: [requestLogger] },
  error:  { all: [requestLogger, logError()] },
});

app.listen(3030);
```

---

## API

### `logger(adapter)`

Plugin factory. Registers a `Logger` adapter on the application.

```typescript
function logger(adapter: Logger): MantlePlugin;
```

```typescript
app.configure(logger(pinoAdapter(pino({ level: "info" }))));
// Equivalent to: app.set("logger", adapter)
```

---

### `pinoAdapter(pinoInstance)`

Wraps a pino logger to satisfy the `Logger` interface. Pino uses `(object, message)` argument order; the `Logger` interface uses `(message, object)`. The adapter flips this internally.

On every log call the adapter reads `getContext()` from `@mantlejs/mantle` and merges the current `RequestContext` (including `correlationId`) into the pino object. Per-call context fields take precedence over request context fields. When called outside an Express request (e.g. a startup log), no context is present and the field is simply omitted.

```typescript
function pinoAdapter(pino: PinoLike): Logger;
```

```typescript
import pino from "pino";
import { pinoAdapter } from "@mantlejs/logger";

const adapter = pinoAdapter(pino({ level: process.env.LOG_LEVEL ?? "info" }));
```

`PinoLike` is a minimal duck-type — any object with `debug`, `info`, `warn`, and `error` methods accepting `(object, message)` will work. If the wrapped instance has a `child(bindings)` method (real pino instances do), the returned `Logger` gets one too — see [`Logger.child(bindings)`](#loggerchildbindings) below.

---

### `createLogger(options?)`

Builds a `Logger` backed by pino, with production-ready defaults baked in: environment-aware level, PII redaction, and Google Cloud severity mapping. `pino` is loaded lazily — nothing is required at module load time, only when `createLogger()` actually runs.

```typescript
function createLogger(options?: CreateLoggerOptions): Promise<Logger>;

interface CreateLoggerOptions {
  /** Default: "info" when NODE_ENV === "production", else "debug". */
  level?: "debug" | "info" | "warn" | "error";
  /** Pino redact paths. Default: SENSITIVE_PATHS. Pass [] to disable. */
  redact?: string[];
  /** Pretty-print via pino-pretty when available. Default: false. Ignored in production. */
  pretty?: boolean;
  /** Google Cloud structured logging: level -> `severity` labels, message key "message". Default: false. */
  gcp?: boolean;
  /** Extra pino options merged last (escape hatch). */
  pino?: Record<string, unknown>;
}
```

```typescript
import { logger, createLogger } from "@mantlejs/logger";

app.configure(
  logger(
    await createLogger({
      pretty: process.env.NODE_ENV !== "production",
      gcp: process.env.NODE_ENV === "production",
    }),
  ),
);
```

- **`redact`** — defaults to the exported `SENSITIVE_PATHS` (`["password", "*.password", "*.accessToken", "*.refreshToken", "*.authorization", "*.cookie"]`), passed straight to pino's `redact.paths` with `censor: "[Redacted]"`. Pass `[]` to disable pino-level redaction entirely (e.g. if you configure your own).
- **`pretty`** — when `true` and not in production, `createLogger` checks whether `pino-pretty` is resolvable before setting `transport: { target: "pino-pretty" }`. If it isn't installed, logging still works — output falls back to plain JSON and a one-time `console.warn` names the missing package. `pretty` has no effect in production.
- **`gcp`** — sets `messageKey: "message"` and a `formatters.level` mapping (`debug`→`DEBUG`, `info`→`INFO`, `warn`→`WARNING`, `error`→`ERROR`) so [Cloud Logging](https://cloud.google.com/logging/docs/structured-logging) picks up the right severity and renders the message field. See [Deployment](#deployment) below.
- **`pino`** — an escape hatch merged into the built options object last, so it can override any computed default (including `level` or `redact`).
- If `pino` cannot be resolved (not installed), `createLogger()` throws a `GeneralError` naming the missing package, with `hint: "Install it with: npm install pino"`.

---

### `logRequest(options?)`

Returns a hook that logs service call duration. Register the **same returned function** in `before.all`, `after.all`, **and** `error.all`. The before phase records the start time; the after or error phase emits the record with elapsed duration and `status`.

```typescript
function logRequest(options?: LogRequestOptions): HookFunction;

interface LogRequestOptions {
  /** Log level for calls. Default: 'debug' */
  level?: "debug" | "info";
  /**
   * Include params in the log record. Default: false.
   *
   * WARNING: params can contain sensitive data — query strings, auth tokens,
   * pagination secrets, or any value a hook has attached. Only enable this
   * in development, or pair it with pino's `redact` option to strip known
   * sensitive paths before they reach the transport.
   */
  includeParams?: boolean;
  /** Paths redacted from `params` when includeParams is true. Default: SENSITIVE_PATHS. */
  redactParams?: string[];
}
```

`redactParams` runs a small own-code deep walk over `params` — replacing matched fields with `"[Redacted]"` — **before** the record reaches the logger. This works for every adapter, not just `pinoAdapter`; pino's own `redact` option (configured via `createLogger`) remains defense in depth on top of it.

```typescript
const requestLogger = logRequest();

app.service("users").hooks({
  before: { all: [requestLogger] },
  after:  { all: [requestLogger] },
  error:  { all: [requestLogger, logError()] },
});
```

**Success record** (message: `"Service call completed"`):

```json
{
  "component": "mantle:request",
  "method": "get",
  "path": "users",
  "provider": "rest",
  "id": "42",
  "durationMs": 12,
  "status": "ok"
}
```

`id` is only present for `get`, `update`, `patch`, and `remove` calls. `correlationId` is automatically included by `pinoAdapter` when inside an Express request.

**Error record** (message: `"Service call failed"`):

```json
{
  "component": "mantle:request",
  "method": "create",
  "path": "users",
  "provider": "rest",
  "durationMs": 1,
  "status": "error"
}
```

---

### `logError(options?)`

Error hook. Logs structured error details from `ctx.error`. Maps `4xx` errors to `warn`, `5xx` to `error` by default.

```typescript
function logError(options?: LogErrorOptions): HookFunction;

interface LogErrorOptions {
  /** Log 4xx as 'warn', 5xx as 'error'. Default: true */
  levelByCode?: boolean;
  /** Include stack trace. Default: true when NODE_ENV !== 'production' */
  includeStack?: boolean;
}
```

```typescript
app.service("users").hooks({
  error: { all: [logError()] },
});
```

**Emitted record:**

```json
{
  "component": "mantle:error",
  "method": "create",
  "path": "users",
  "provider": "rest",
  "code": 409,
  "name": "Conflict",
  "message": "Email already exists",
  "data": { "field": "email" },
  "stack": "..."
}
```

`data` (the `MantleError`'s `data` payload) is only present when the error carries one, and is redacted with the same `SENSITIVE_PATHS` walk used by `logRequest`'s `redactParams`.

---

### `Logger.child(bindings)`

`Logger` (from `@mantlejs/mantle`) declares `child` as **optional** — implementations may omit it, and callers must feature-check before use:

```typescript
interface Logger {
  debug(msg: string, context?: Record<string, unknown>): void;
  info(msg: string, context?: Record<string, unknown>): void;
  warn(msg: string, context?: Record<string, unknown>): void;
  error(msg: string, context?: Record<string, unknown>): void;
  child?(bindings: Record<string, unknown>): Logger;
}
```

Both adapters this package ships implement it:

- **`pinoAdapter`** — delegates to the wrapped instance's own `pino.child(bindings)`, re-wrapped through `pinoAdapter` so `RequestContext` merging (`correlationId`, etc.) keeps working on the child logger too. If the wrapped object has no `child` method, the returned `Logger` won't have one either.
- **`loglayerAdapter`** — has no native LogLayer `child()` involved; bindings are closed over and folded into every subsequent `withMetadata()` call instead.

```typescript
const requestLog = log.child?.({ requestId: "abc-123" }) ?? log;
requestLog.info("handling request"); // every record includes requestId: "abc-123"
```

Mantle's own hooks never call `child` unconditionally — it's an opt-in for application code that wants scoped loggers (e.g. one per background job, per queue consumer).

---

### `loglayerAdapter(logLayerInstance)`

Wraps a [LogLayer](https://loglayer.dev) instance to satisfy the `Logger` interface. `loglayer` itself is **not** a dependency of any Mantle package — `LogLayerLike` is a duck-type, so any object shaped like a LogLayer instance works.

```typescript
function loglayerAdapter(log: LogLayerLike): Logger;

interface LogLayerLike {
  withMetadata(meta: Record<string, unknown>): {
    debug(msg: string): void;
    info(msg: string): void;
    warn(msg: string): void;
    error(msg: string): void;
  };
  child?(): unknown;
}
```

```typescript
import { LogLayer, ConsoleTransport } from "loglayer";
import { logger, loglayerAdapter } from "@mantlejs/logger";

const log = new LogLayer({ transport: new ConsoleTransport({ logger: console }) });

app.configure(logger(loglayerAdapter(log)));
```

Like `pinoAdapter`, every call merges the current `RequestContext` into the metadata passed to `withMetadata()`. `child(bindings)` closes over the merged bindings rather than calling LogLayer's own `child()` (whose semantics differ) — bindings are folded into every subsequent `withMetadata()` call, and nested `child()` calls compose.

See [Using LogLayer](#using-loglayer) below for a transport fan-out example.

---

## PII and sensitive data

Mantle's default log records are intentionally narrow — only service metadata (`method`, `path`, `provider`, `id`, `durationMs`, `status`) and error details reach the log output. The fields most likely to carry PII are **never logged by default**:

| Field | Logged? | Notes |
|---|---|---|
| `ctx.data` (request body) | No | Passwords, email addresses, payment info |
| `ctx.result` (response body) | No | Full entity records |
| `ctx.params` | No (opt-in) | Query strings, auth tokens — see `includeParams` warning above |
| `correlationId` | Yes | A UUID — not PII |
| `ctx.id` | Yes | A resource identifier — usually not PII |

### Redacting fields with `createLogger`

`createLogger({ redact })` is the recommended approach when using pino — it configures pino's built-in [`redact`](https://getpino.io/#/docs/redaction) option (`fast-redact` with JSONPath patterns, applied before serialisation) and defaults to the exported `SENSITIVE_PATHS`:

```typescript
import { logger, createLogger } from "@mantlejs/logger";

app.configure(
  logger(
    await createLogger({
      redact: ["user.email", "user.password", "params.query.token", "*.creditCard"],
    }),
  ),
);
```

This applies globally to every record without any changes to Mantle hooks or the `Logger` interface. If you build a pino instance yourself instead of using `createLogger`, pass the same `redact` option directly to `pino({ ... })` before wrapping it with `pinoAdapter`.

### Redacting with `logRequest`/`logError` (works with any adapter)

`logRequest({ redactParams })` and `logError()` run their own small deep-walk redaction (see [`redactPaths`](#redactpathsvalue-paths) below) over `params` and `error.data` respectively, before the record reaches *any* logger — pino, LogLayer, winston, or a custom one. This is defense in depth on top of pino-level redaction, and the only redaction available to non-pino adapters.

### Redacting with winston or a custom logger

Configure redaction at the transport or formatter level in your logger of choice. Mantle does not add a redaction layer on top of the underlying logger — except via `logRequest`/`logError` as described above.

---

## Using a different logger

### LogLayer

Use `loglayerAdapter` — see [`loglayerAdapter(logLayerInstance)`](#loglayeradapterloglayerinstance) above.

### Winston

Winston's `debug`, `info`, `warn`, and `error` methods already match the `Logger` interface signature — no adapter needed. Skip installing `@mantlejs/logger` entirely if you only want winston:

```typescript
import winston from "winston";

const winstonLogger = winston.createLogger({
  level: process.env.LOG_LEVEL ?? "info",
  transports: [new winston.transports.Console()],
});

app.set("logger", winstonLogger);
```

You can still use the `logRequest()` and `logError()` hook factories from `@mantlejs/logger` alongside a winston logger — they read the logger from `app.get('logger')` regardless of implementation.

### Custom / console logger

Any object satisfying the four-method `Logger` interface works:

```typescript
app.set("logger", {
  debug: (msg, ctx) => console.debug(msg, ctx),
  info:  (msg, ctx) => console.info(msg, ctx),
  warn:  (msg, ctx) => console.warn(msg, ctx),
  error: (msg, ctx) => console.error(msg, ctx),
});
```

---

### `redactPaths(value, paths?)`

The own-code deep-walk redaction helper used internally by `logRequest` and `logError`. Exported so application code can reuse it.

```typescript
function redactPaths(value: unknown, paths?: string[]): unknown; // default: SENSITIVE_PATHS
```

Path syntax is a small subset of pino's `redact.paths`: a bare key (`"password"`) matches only at the top level; a `"*.key"` entry matches `key` at any depth. Returns a deep clone — the input is never mutated.

```typescript
import { redactPaths, SENSITIVE_PATHS } from "@mantlejs/logger";

redactPaths({ user: { password: "hunter2" } });
// => { user: { password: "[Redacted]" } }

SENSITIVE_PATHS; // ["password", "*.password", "*.accessToken", "*.refreshToken", "*.authorization", "*.cookie"]
```

---

## Types

```typescript
import type {
  PinoLike,
  LogLayerLike,
  CreateLoggerOptions,
  LogRequestOptions,
  LogErrorOptions,
} from "@mantlejs/logger";
import type { Logger } from "@mantlejs/mantle";
```

| Type | Description |
|---|---|
| `Logger` | Core interface — re-exported from `@mantlejs/mantle`. `child` is optional. |
| `PinoLike` | Duck-type accepted by `pinoAdapter()` |
| `LogLayerLike` | Duck-type accepted by `loglayerAdapter()` |
| `CreateLoggerOptions` | Options for `createLogger()` |
| `LogRequestOptions` | Options for `logRequest()` |
| `LogErrorOptions` | Options for `logError()` |

---

## Deployment

### Cloud Run

Pass `gcp: true` to `createLogger()` when running on Cloud Run (or any GKE/Cloud Logging environment). It maps Mantle's four levels to Cloud Logging `severity` labels and renames the message field, so structured fields survive intact in the Logs Explorer instead of being flattened into `textPayload`:

```typescript
const log = await createLogger({ gcp: process.env.NODE_ENV === "production" });
```

Write to **stdout only** — Cloud Run collects container stdout/stderr automatically. Don't configure file transports; there's no persistent disk, and a second write target only adds latency. This is also why `pretty` is ignored in production: pretty-printed multi-line output does not parse as structured JSON by the log agent.

### Level configuration via `@mantlejs/config`

Read the log level from `@mantlejs/config` instead of hardcoding it, so it can be overridden per environment without a redeploy. `config()` and `logger()` both call `app.set("logger", ...)` — `config()` sets it to the raw config object, `logger()` overwrites it with the actual `Logger` instance — so **configure `config()` before `logger()`**:

```typescript
import { config } from "@mantlejs/config";
import { logger, createLogger } from "@mantlejs/logger";
import type { CreateLoggerOptions } from "@mantlejs/logger";

app.configure(config()); // reads config/default.json + config/{NODE_ENV}.json + MANTLE_* env vars

const { level } = app.get<{ logger?: { level?: string } }>("config").logger ?? {};
app.configure(logger(await createLogger({ level: level as CreateLoggerOptions["level"] })));
```

```jsonc
// config/default.json
{ "logger": { "level": "info" } }
```

```
MANTLE_LOGGER__LEVEL=debug npm start   # env override, no redeploy
```

### Process-level error handlers

Pino/LogLayer only capture errors that flow through a service call. Wire the two Node.js process-level events too, so nothing crashes silently:

```typescript
const log = await createLogger();

process.on("uncaughtException", (err) => {
  log.error("Uncaught exception", { component: "mantle:process", name: err.name, message: err.message, stack: err.stack });
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  log.error("Unhandled rejection", { component: "mantle:process", name: err.name, message: err.message, stack: err.stack });
});
```

### Log-based metrics

Every record `logRequest`/`logError` emit carries a `component` field (`mantle:request` or `mantle:error`). Build log-based metrics/alerts (Cloud Monitoring, Datadog, Grafana Loki) filtered on `component`, without needing a separate metrics pipeline:

- `component="mantle:request" AND status="error"` — error rate by `path`/`method`
- `component="mantle:request"` — p50/p95 `durationMs` by `path`
- `component="mantle:error" AND code>=500` — 5xx volume, paged separately from 4xx noise

### Using LogLayer

`loglayerAdapter` lets LogLayer's own transport fan-out do double duty — one Mantle `Logger` writing to multiple destinations at once:

```typescript
import { LogLayer, MultiTransport, ConsoleTransport, DatadogTransport } from "loglayer";
import { logger, loglayerAdapter } from "@mantlejs/logger";

const log = new LogLayer({
  transport: new MultiTransport([
    new ConsoleTransport({ logger: console }),
    new DatadogTransport({ apiKey: process.env.DATADOG_API_KEY! }),
  ]),
});

app.configure(logger(loglayerAdapter(log)));
```

`logRequest` and `logError` work unchanged — they only depend on the `Logger` interface, never on LogLayer directly.

---

## Development

```bash
npx nx build logger   # compile
npx nx test logger    # run tests
npx nx lint logger    # lint
```

---

## Publishing

Build before publishing:

```bash
npx nx build logger
```

First publish (scoped packages require `--access public`):

```bash
cd packages/logger
npm publish --access public
```

Subsequent releases — bump `version` in `packages/logger/package.json`, then:

```bash
cd packages/logger
npm publish
```

### Testing locally with Verdaccio

```bash
# Terminal 1 — start the local registry
npx nx run @mantle/source:local-registry

# Terminal 2 — publish to it
cd packages/logger
npm publish --registry http://localhost:4873

# Install from it in another project
npm install @mantlejs/logger --registry http://localhost:4873
```
