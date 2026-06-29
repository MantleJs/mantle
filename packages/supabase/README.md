# @mantlejs/supabase

Supabase adapter for [Mantle JS](https://github.com/mantlejs/mantle). Provides a `supabase()` plugin, an abstract `SupabaseRepository<T>` base class backed by Supabase PostgREST, a `supabaseAdapter()` for cross-instance event sync via Supabase Realtime Broadcast, and optional Postgres Changes subscriptions that translate direct DB mutations into Mantle service events.

---

## Installation

```bash
npm install @mantlejs/supabase @supabase/supabase-js
```

---

## Concepts

### The `supabase()` plugin

`supabase(config)` is a Mantle plugin. It creates a `SupabaseClient` and stores it on the application at `app.get("supabase")`. Call it once during app configuration before registering any repositories.

### `SupabaseRepository<T>`

`SupabaseRepository` is an abstract base class that implements all eight `Repository<T>` methods against a Supabase-hosted PostgreSQL table via the Supabase PostgREST API. Extend it, set `tableName`, and optionally override `primaryKey` and `timestamps`.

### `supabaseAdapter()` — Realtime Broadcast sync transport

`supabaseAdapter()` returns a `SyncAdapter` compatible with `@mantlejs/sync`. It replaces Redis with Supabase Realtime Broadcast channels so teams already using Supabase get horizontal scaling with zero additional infrastructure.

### `listenToChanges` — Postgres Changes subscription

When a `SupabaseRepository<T>` subclass sets `readonly listenToChanges = true`, it opens a Supabase Realtime Postgres Changes subscription. Direct database mutations from PostgREST, Supabase Studio, migrations, or any other source are automatically translated to Mantle `service:event` emissions and fan out through the app event bus. This works alongside `@mantlejs/sync` — both can be active simultaneously.

### QueryParams support

All standard Mantle `QueryParams` operators are translated to PostgREST filter calls:

| Operator                     | PostgREST equivalent                          |
| ---------------------------- | --------------------------------------------- |
| `{ field: value }`           | `.eq(field, value)`                           |
| `{ field: null }`            | `.is(field, null)`                            |
| `$lt`, `$lte`, `$gt`, `$gte` | `.lt()`, `.lte()`, `.gt()`, `.gte()`          |
| `$ne`                        | `.neq()` / `.not(field, "is", null)` for null |
| `$in`                        | `.in(field, [])`                              |
| `$nin`                       | `.not(field, "in", "(…)")`                    |
| `$like`, `$ilike`            | `.like()`, `.ilike()`                         |
| `$notlike`                   | `.not(field, "like", pattern)`                |
| `$or`                        | `.or(filter)`                                 |
| `$and`                       | chained calls                                 |

---

## Quick start

```typescript
import { mantle } from "@mantlejs/mantle";
import { express } from "@mantlejs/express";
import { supabase, SupabaseRepository } from "@mantlejs/supabase";

// 1. Configure the plugin
const app = mantle()
  .configure(express())
  .configure(
    supabase({
      url: process.env.SUPABASE_URL!,
      key: process.env.SUPABASE_KEY!,
    }),
  );

// 2. Define your entity
interface User {
  id: string;
  name: string;
  email: string;
  created_at?: string;
  updated_at?: string;
}

// 3. Create a repository
class UserRepository extends SupabaseRepository<User> {
  readonly tableName = "users";
}

// 4. Wire it up
app.use("/users", new UserService(new UserRepository(app)));

app.listen(3030);
```

### Custom queries

Access the raw PostgREST query builder via `this.db` inside your repository:

```typescript
class UserRepository extends SupabaseRepository<User> {
  readonly tableName = "users";

  async findByEmail(email: string): Promise<User | null> {
    const { data, error } = await this.db.select("*").eq("email", email).maybeSingle();
    if (error) throw this.wrapError(error);
    return data ?? null;
  }
}
```

---

## API

### `supabase(config)`

Returns a `MantlePlugin`. Call via `app.configure(supabase(config))`.

```typescript
app.configure(
  supabase({
    url: process.env.SUPABASE_URL!, // required — Supabase project URL
    key: process.env.SUPABASE_KEY!, // required — anon or service_role key
    options: {
      // optional — SupabaseClientOptions
      auth: { autoRefreshToken: false },
    },
  }),
);
```

Side effects:

- Stores the `SupabaseClient` at `app.get("supabase")`

#### `SupabaseConfig`

| Field     | Type                    | Default | Description                                                                          |
| --------- | ----------------------- | ------- | ------------------------------------------------------------------------------------ |
| `url`     | `string`                | —       | Supabase project URL (required)                                                      |
| `key`     | `string`                | —       | Supabase API key — `anon` for client-side, `service_role` for server-side (required) |
| `options` | `SupabaseClientOptions` | —       | Additional Supabase client options (optional)                                        |

---

### `SupabaseRepository<T, D>`

Abstract base class. Extend with a concrete `tableName`.

```typescript
abstract class SupabaseRepository<T, D = Partial<T>> implements Repository<T, D> {
  abstract readonly tableName: string;
  readonly primaryKey: string; // default: "id"
  readonly timestamps: boolean; // default: true
}
```

#### Instance properties

| Property     | Type      | Default | Description                                             |
| ------------ | --------- | ------- | ------------------------------------------------------- |
| `tableName`  | `string`  | —       | Supabase table name (abstract — must be set)            |
| `primaryKey` | `string`  | `"id"`  | Primary key column name                                 |
| `timestamps` | `boolean` | `true`  | Auto-write `created_at` / `updated_at` ISO-8601 strings |

#### `Repository<T>` methods

| Method                 | Description                                                              |
| ---------------------- | ------------------------------------------------------------------------ |
| `findAll(params?)`     | Fetch all rows matching `QueryParams` (where, sort, limit, skip, select) |
| `findById(id)`         | Fetch a single row by primary key; returns `null` if not found           |
| `save(data)`           | Insert a new row and return it                                           |
| `saveAll(data[])`      | Insert multiple rows and return them                                     |
| `updateById(id, data)` | Replace all non-key columns; throws `NotFound` if missing                |
| `patchById(id, data)`  | Merge supplied fields only; throws `NotFound` if missing                 |
| `deleteById(id)`       | Delete a row and return it; throws `NotFound` if missing                 |
| `count(params?)`       | Count rows matching optional `where` clause                              |

#### `protected db`

Returns a PostgREST `PostgrestQueryBuilder` scoped to `tableName`. Use it in subclass custom queries.

#### `listenToChanges`

Set `readonly listenToChanges = true` in a subclass to subscribe to Postgres Changes for that table. Requires Realtime to be enabled for the table in your Supabase project settings.

```typescript
class PostRepository extends SupabaseRepository<Post> {
  readonly tableName = "posts";
  readonly listenToChanges = true; // subscribe to WAL-based DB events
}
```

Changes are emitted as `service:event` on the app event bus:

| Postgres event | Mantle event |
| -------------- | ------------ |
| `INSERT`       | `created`    |
| `UPDATE`       | `patched`    |
| `DELETE`       | `removed`    |

#### `protected wrapError(err)`

Maps Supabase / PostgreSQL error codes to typed `MantleError` subclasses. Call it in custom query methods to keep error handling consistent.

---

### `supabaseAdapter(options?)`

Returns a `SyncAdapter` for use with `@mantlejs/sync`. Credentials fall back to `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` (or `SUPABASE_KEY`) environment variables.

```typescript
import { sync } from "@mantlejs/sync";
import { supabase, supabaseAdapter } from "@mantlejs/supabase";

const app = mantle()
  .configure(express())
  .configure(supabase({ url: process.env.SUPABASE_URL!, key: process.env.SUPABASE_SERVICE_KEY! }))
  .configure(socketio())
  .configure(sync({ adapter: supabaseAdapter() }));
```

#### `SupabaseAdapterOptions`

| Field | Type     | Default                          | Description                  |
| ----- | -------- | -------------------------------- | ---------------------------- |
| `url` | `string` | `SUPABASE_URL` env var           | Supabase project URL         |
| `key` | `string` | `SUPABASE_SERVICE_KEY` env var   | Service role key             |

---

## Types

```typescript
import type { SupabaseConfig, SupabaseAdapterOptions, SyncAdapter, SyncMessage } from "@mantlejs/supabase";
import { SupabaseRepository, supabaseAdapter } from "@mantlejs/supabase";
```

| Export                   | Kind           | Description                                   |
| ------------------------ | -------------- | --------------------------------------------- |
| `SupabaseConfig`         | interface      | Options passed to `supabase()`                |
| `SupabaseRepository`     | abstract class | Base repository class to extend               |
| `SupabaseAdapterOptions` | interface      | Options passed to `supabaseAdapter()`         |
| `SyncAdapter`            | interface      | Pluggable transport interface for sync        |
| `SyncMessage`            | interface      | Cross-instance sync message shape             |
| `supabaseAdapter`        | function       | Factory that returns a Supabase `SyncAdapter` |

---

## Error mapping

All errors are converted to typed `MantleError` subclasses:

| PostgreSQL / PostgREST code | Error thrown         | Condition                                |
| --------------------------- | -------------------- | ---------------------------------------- |
| `PGRST116`                  | `NotFound` (404)     | Zero rows returned by a `.single()` call |
| `23505`                     | `Conflict` (409)     | Unique constraint violation              |
| `23503`, `23514`, `23502`   | `BadRequest` (400)   | FK, check, or NOT NULL violation         |
| `42501`, `28000`, `28P01`   | `Forbidden` (403)    | Insufficient privilege                   |
| anything else               | `GeneralError` (500) | Unexpected error                         |

---

## Development

```bash
npx nx build supabase   # compile
npx nx test supabase    # run tests
npx nx lint supabase    # lint
```

---

## Publishing

Build before publishing:

```bash
npx nx build supabase
```

First publish (scoped packages require `--access public`):

```bash
cd packages/supabase
npm publish --access public
```

Subsequent releases — bump `version` in `packages/supabase/package.json`, then:

```bash
cd packages/supabase
npm publish
```

### Testing locally with Verdaccio

```bash
# Terminal 1 — start the local registry
npx nx run @mantle/source:local-registry

# Terminal 2 — publish to it
cd packages/supabase
npm publish --registry http://localhost:4873

# Install from it in another project
npm install @mantlejs/supabase --registry http://localhost:4873
```
