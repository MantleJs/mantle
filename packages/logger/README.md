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
  error:  { all: [logError()] },
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

Returns a hook that logs service call duration. Register the **same returned function** in both `before.all` and `after.all`. The first call (before phase) records the start time; the second call (after phase) emits the log record.

```typescript
function logRequest(options?: LogRequestOptions): HookFunction;

interface LogRequestOptions {
  /** Log level for successful calls. Default: 'debug' */
  level?: "debug" | "info";
  /** Include params in the log record. Default: false — may contain sensitive data */
  includeParams?: boolean;
}
```

```typescript
const requestLogger = logRequest();

app.service("users").hooks({
  before: { all: [requestLogger] },
  after:  { all: [requestLogger] },
});
```

**Emitted record:**

```json
{
  "component": "mantle:request",
  "method": "create",
  "path": "users",
  "provider": "rest",
  "durationMs": 12,
  "status": "ok"
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
