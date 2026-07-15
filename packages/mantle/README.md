# @mantlejs/mantle

The framework kernel for Mantle JS. Zero external dependencies. Defines all core interfaces, the application factory, and typed error classes used across every other package.

## Installation

```bash
npm install @mantlejs/mantle
```

## Quick start

```typescript
import { mantle } from "@mantlejs/mantle";

const app = mantle();

app.use("users", new UserService());

app.service("users").hooks({
  before: { create: [validateUser()] },
  after: { all: [sanitize()] },
});
```

## API

### `mantle(options?)`

Creates a `MantleApplication` instance.

```typescript
const app = mantle();
```

#### `app.use(path, service, options?)`

Registers a service at a path. `options.methods` restricts which of the six standard methods are exposed (defaults to all six).

```typescript
app.use("users", new UserService(), {
  methods: ["find", "get", "create", "patch", "remove"],
});
```

#### `app.service(path)`

Returns the `ServiceHandle` for a registered path. Throws `NotFound` if the path is not registered.

```typescript
const result = await app.service("users").find({ query: { role: "admin" } });
```

#### `app.configure(plugin)`

Applies a plugin (e.g. `express()`, `knex()`) to the application.

```typescript
app.configure(express()).configure(knex({ client: "pg", connection: DATABASE_URL }));
```

#### `app.set(key, value)` / `app.get(key)`

Typed key-value store used by plugins to share instances (e.g. the knex instance is stored under `"knex"`).

#### `app.teardown()`

Gracefully shuts down all registered resources. Call on process exit.

---

### `Service<T, D>`

The contract every service must satisfy. All methods are optional — only implement what you need and restrict the rest via `options.methods`.

```typescript
interface Service<T, D = Partial<T>> {
  find(params?: ServiceParams): Promise<T[] | Paginated<T>>;
  get(id: Id, params?: ServiceParams): Promise<T>;
  create(data: D, params?: ServiceParams): Promise<T>;
  update(id: Id, data: D, params?: ServiceParams): Promise<T>;
  patch(id: Id, data: D, params?: ServiceParams): Promise<T>;
  remove(id: Id, params?: ServiceParams): Promise<T>;
}
```

Custom methods beyond these six must be explicitly listed in `options.methods` when calling `app.use()`.

---

### `Repository<T, D>`

Interface for data access implementations (e.g. `KnexRepository`). Lives in the Infrastructure layer and is never imported by services directly.

```typescript
interface Repository<T, D = Partial<T>> {
  findAll(params?: QueryParams): Promise<T[]>;
  findById(id: Id): Promise<T | null>;
  save(data: D): Promise<T>;
  saveAll(data: D[]): Promise<T[]>;
  updateById(id: Id, data: D): Promise<T>;
  patchById(id: Id, data: D): Promise<T>;
  deleteById(id: Id): Promise<T>;
  count(params?: QueryParams): Promise<number>;
  describe?(): RepositoryCapabilities; // optional capability introspection
}
```

---

### Introspection — `describe()`

Machine-readable self-description at both layers, so tooling (OpenAPI generation, the transports'
opt-in `/_services` endpoint, AI agents) can discover capabilities instead of probing by trial and error.

#### `Repository.describe()` → `RepositoryCapabilities`

Every @mantlejs adapter implements the optional `describe()`; user repositories may omit it.

```typescript
interface RepositoryCapabilities {
  adapter: string; // package name, e.g. "@mantlejs/knex"
  operators: string[]; // exactly the $-operators the adapter's where translator accepts
  pagination: "offset" | "cursor" | "both";
  fullTextSearch: boolean;
  scanning?: (where: Record<string, unknown>) => boolean; // e.g. DynamoDB: true when the where clause forces a full Scan
}
```

#### `ServiceHandle.describe()` → `ServiceDescriptor`

```typescript
const descriptor = app.service("users").describe();

interface ServiceDescriptor {
  path: string;
  methods: string[];
  events: string[]; // standard created/updated/patched/removed filtered by methods, plus custom ServiceOptions.events
  schema?: unknown; // the stored ServiceOptions.schema (JSON Schema — a TypeBox schema works)
  capabilities?: RepositoryCapabilities; // present when the service exposes describe() — RepositoryService wires this through
  authRequired?: boolean; // true when a before.all hook carries an authStrategy marker, e.g. authenticate("jwt")
}
```

The HTTP transports (`@mantlejs/express`, `@mantlejs/koa`, `@mantlejs/http`) can serve every
registered service's descriptor at `GET /_services` via their opt-in `introspection` option.

---

### `RepositoryService<T, D>`

A ready-made `Service<T>` over any `Repository<T>` — the framework-owned bridge from raw HTTP query strings to typed `QueryParams`. Use it when a service is a straight CRUD facade over a repository; add hooks for everything else.

```typescript
import { RepositoryService } from "@mantlejs/mantle";

app.use(
  "users",
  new RepositoryService(new UserRepository(app), {
    schema: userSchema, // any object with { properties: { field: { type } } } — a TypeBox schema works
    fields: ["name", "age", "active"], // optional whitelist of queryable fields
    paginate: { default: 25, max: 100 },
  }),
);
```

#### Query conventions

Reserved keys inside `query` (everything else becomes the repository `where` clause):

| Key | Example | Meaning |
| --------- | ----------------------- | ---------------------------------------------- |
| `$limit` | `?$limit=10` | page size (capped at `paginate.max` when set) |
| `$skip` | `?$skip=20` | offset |
| `$sort` | `?$sort[name]=asc` | sort order — accepts `asc`/`desc`/`1`/`-1` |
| `$select` | `?$select[]=name` | field projection |

`GET /users?age[$gt]=21&$limit=10&$sort[name]=asc` becomes
`repository.findAll({ where: { age: { $gt: 21 } }, limit: 10, sort: { name: "asc" } })`.

#### Behavior guarantees

- **`find()` always returns `Paginated<T>`** — `{ total, limit, skip, data }`, with `total` from `repository.count({ where })`. No `T[] | Paginated<T>` branching for consumers.
- **Field whitelist** — with `options.fields`, a where/sort/select key outside the list throws `BadRequest` naming the field and the allowed set.
- **String coercion** — query values arrive as strings over HTTP. With `options.schema`, values are coerced to each field's declared type (`number`, `integer`, `boolean`), including inside operator objects, `$in`/`$nin` arrays, and `$or`/`$and` branches. **Without a schema, strings pass through unchanged** — `age[$gt]=21` then compares against the string `"21"`, so provide a schema for any non-string field you query.
- `update`/`patch`/`remove` propagate the repository's `NotFound` untouched; `get()` maps a `null` lookup to `NotFound`.

---

### Hooks

Hooks are plain functions — no classes. They run in three phases: `before`, `after`, and `error`. The `all` key applies to every method in that phase.

```typescript
type HookFunction<T> = (context: HookContext<T>) => Promise<HookContext<T>> | HookContext<T>;
```

Register hooks via `app.service(path).hooks(config)`:

```typescript
app.service("users").hooks({
  before: {
    all: [authenticate("jwt")],
    create: [hashPassword()],
  },
  after: {
    all: [sanitizeUser()],
  },
  error: {
    all: [logError()],
  },
});
```

#### `HookContext<T>`

| Field      | Type                            | Description                                 |
| ---------- | ------------------------------- | ------------------------------------------- |
| `app`      | `MantleApplication`             | The application instance                    |
| `service`  | `Partial<Service<T>>`           | The service being called                    |
| `path`     | `string`                        | Registered path, e.g. `"users"`             |
| `method`   | `string`                        | Method name, e.g. `"create"`                |
| `provider` | `string \| undefined`           | `"rest"` for HTTP calls, `undefined` internally |
| `params`   | `ServiceParams`                 | Query, headers, user, etc.                  |
| `data`     | `Partial<T> \| undefined`       | Request body (write methods)                |
| `id`       | `Id \| undefined`               | Record identifier (get/update/patch/remove) |
| `result`   | `T \| T[] \| Paginated<T> \| undefined` | Set by the service or an `after` hook |
| `error`    | `Error \| undefined`            | Set when an error occurs                    |

Setting `context.result` in a `before` hook skips the service call entirely.

---

### Error classes

Always throw a typed error — never a plain `new Error()`.

| Class               | HTTP status | `className`          |
| ------------------- | ----------- | -------------------- |
| `BadRequest`        | 400         | `bad-request`        |
| `NotAuthenticated`  | 401         | `not-authenticated`  |
| `Forbidden`         | 403         | `forbidden`          |
| `NotFound`          | 404         | `not-found`          |
| `MethodNotAllowed`  | 405         | `method-not-allowed` |
| `Conflict`          | 409         | `conflict`           |
| `Unprocessable`     | 422         | `unprocessable`      |
| `TooManyRequests`   | 429         | `too-many-requests`  |
| `GeneralError`      | 500         | `general-error`      |
| `NotImplemented`    | 501         | `not-implemented`    |
| `Unavailable`       | 503         | `unavailable`        |

All errors accept `(message?, data?, errors?, hint?)` and serialize via `.toJSON()`.

```typescript
throw new Conflict("Email already exists", { field: "email" });
```

The optional `hint` is actionable guidance for the caller — what to change so the request succeeds. It is included in `toJSON()`, so HTTP error responses carry it to clients (human or agent):

```typescript
throw new BadRequest(
  "Operator $regex is not supported by knex",
  undefined,
  undefined,
  "Rewrite the where clause using only the supported operators, or filter in application code.",
);
```

---

### `Paginated<T>`

```typescript
interface Paginated<T> {
  total: number;
  limit: number;
  skip: number;
  data: T[];
}
```

Return this from `find()` when the caller requests a page.

---

### `QueryParams`

Used by `Repository` methods to filter, sort, and paginate queries.

```typescript
interface QueryParams {
  where?: Record<string, unknown>;
  limit?: number;
  skip?: number;
  sort?: Record<string, "asc" | "desc">;
  select?: string[];
}
```

## Development

```bash
npx nx build core    # compile
npx nx test core     # run tests
npx nx lint core     # lint
```

## Publishing

Build before publishing:

```bash
npx nx build core
```

First publish (scoped packages require `--access public`):

```bash
cd packages/core
npm publish --access public
```

Subsequent releases — bump `version` in `packages/core/package.json`, then:

```bash
cd packages/core
npm publish
```

### Testing locally with Verdaccio

The workspace includes a local registry to smoke-test a publish before pushing to npm:

```bash
# Terminal 1 — start the local registry
npx nx run @mantle/source:local-registry

# Terminal 2 — publish to it
cd packages/core
npm publish --registry http://localhost:4873

# Install from it in another project
npm install @mantlejs/mantle --registry http://localhost:4873
```
