# @mantlejs/logger

Structured logging plugin for [Mantle JS](https://github.com/mantlejs/mantle). Provides a pino adapter and two hook factories — `logRequest` and `logError` — that emit structured JSON records through any logger satisfying the Mantle `Logger` interface.

---

## Installation

```bash
npm install @mantlejs/logger pino
```

`pino` is an optional peer dependency. If you prefer winston or another logger, skip it — see [Using a different logger](#using-a-different-logger).

---

## Concepts

### The Logger interface

`@mantlejs/core` defines a minimal `Logger` interface with four methods: `debug`, `info`, `warn`, and `error`. Every method accepts a message string and an optional context object:

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

The `express()` plugin reads the `X-Correlation-ID` request header (or generates a UUID) and stores it in `@mantlejs/core`'s `AsyncLocalStorage` context via `withContext`. `pinoAdapter` calls `getContext()` on every log call and merges the result into the pino object.

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
import { getContext } from "@mantlejs/core";

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
import pino from "pino";
import { mantle } from "@mantlejs/core";
import { express } from "@mantlejs/express";
import { logger, pinoAdapter, logRequest, logError } from "@mantlejs/logger";

const app = mantle()
  .configure(express())
  .configure(logger(pinoAdapter(pino({ level: process.env.LOG_LEVEL ?? "info" }))));

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

On every log call the adapter reads `getContext()` from `@mantlejs/core` and merges the current `RequestContext` (including `correlationId`) into the pino object. Per-call context fields take precedence over request context fields. When called outside an Express request (e.g. a startup log), no context is present and the field is simply omitted.

```typescript
function pinoAdapter(pino: PinoLike): Logger;
```

```typescript
import pino from "pino";
import { pinoAdapter } from "@mantlejs/logger";

const adapter = pinoAdapter(pino({ level: process.env.LOG_LEVEL ?? "info" }));
```

`PinoLike` is a minimal duck-type — any object with `debug`, `info`, `warn`, and `error` methods accepting `(object, message)` will work.

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
}
```

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
  "stack": "..."
}
```

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

### Redacting fields with pino

If you use `pinoAdapter`, configure field redaction on the pino instance via pino's built-in [`redact`](https://getpino.io/#/docs/redaction) option. It uses `fast-redact` with JSONPath patterns and runs before serialisation:

```typescript
import pino from "pino";
import { logger, pinoAdapter } from "@mantlejs/logger";

app.configure(
  logger(
    pinoAdapter(
      pino({
        level: process.env.LOG_LEVEL ?? "info",
        redact: {
          paths: [
            "user.email",
            "user.password",
            "params.query.token",
            "*.creditCard",
          ],
          censor: "[REDACTED]",
        },
      }),
    ),
  ),
);
```

This is the recommended approach — pino's redaction is fast, well-tested, and applies globally to every record without any changes to Mantle hooks or the `Logger` interface.

### Redacting with winston or a custom logger

Configure redaction at the transport or formatter level in your logger of choice. Mantle does not add a redaction layer on top of the underlying logger.

---

## Using a different logger

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

## Types

```typescript
import type { PinoLike, LogRequestOptions, LogErrorOptions } from "@mantlejs/logger";
import type { Logger } from "@mantlejs/core";
```

| Type | Description |
|---|---|
| `Logger` | Core interface — re-exported from `@mantlejs/core` |
| `PinoLike` | Duck-type accepted by `pinoAdapter()` |
| `LogRequestOptions` | Options for `logRequest()` |
| `LogErrorOptions` | Options for `logError()` |

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
