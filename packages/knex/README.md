# @mantlejs/knex

SQL database adapter for Mantle JS via [Knex.js](https://knexjs.org). Provides a `knex()` plugin that registers a shared Knex instance, and `KnexRepository` — an abstract base class that implements `Repository<T>` for any SQL table.

Supported databases: **PostgreSQL** (primary), **MySQL/MariaDB**, **SQLite**, **MSSQL**.

## Installation

```bash
npm install @mantlejs/knex knex

# Add the driver for your database:
npm install pg           # PostgreSQL
npm install mysql2       # MySQL / MariaDB
npm install better-sqlite3  # SQLite
npm install tedious      # MSSQL
```

## Quick start

```typescript
import { mantle } from "@mantlejs/mantle";
import { knex, KnexRepository } from "@mantlejs/knex";

const app = mantle().configure(
  knex({ client: "pg", connection: process.env.DATABASE_URL }),
);

class UserRepository extends KnexRepository<User> {
  readonly tableName = "users";
}

app.use("users", new UserService(new UserRepository(app)));
```

## API

### `knex(config)`

Returns a `MantlePlugin`. When applied via `app.configure(knex(...))`, it creates a Knex instance, stores it under `app.get("knex")`, and registers a teardown callback that destroys the connection pool on `app.teardown()`.

```typescript
interface KnexConfig {
  client: string;                        // 'pg' | 'mysql2' | 'sqlite3' | 'mssql' | ...
  connection: Knex.Config["connection"]; // connection string or object
  pool?: { min?: number; max?: number }; // defaults: min 2, max 10
  searchPath?: string | string[];        // PostgreSQL schema search path
}
```

Examples:

```typescript
// PostgreSQL
app.configure(knex({ client: "pg", connection: process.env.DATABASE_URL }));

// SQLite
app.configure(knex({ client: "sqlite3", connection: { filename: "./dev.db" } }));

// MySQL
app.configure(knex({ client: "mysql2", connection: { host: "localhost", user: "root", database: "myapp" } }));
```

---

### `KnexRepository<T, D>`

Abstract base class implementing `Repository<T, D>`. Extend it and set `tableName`.

```typescript
abstract class KnexRepository<T, D = Partial<T>> implements Repository<T, D> {
  abstract readonly tableName: string;
  readonly idField: string = "id";       // override to use a different PK column
  readonly timestamps: boolean = true;   // auto-manages createdAt / updatedAt
}
```

#### Methods

| Method                             | Description                                      |
| ---------------------------------- | ------------------------------------------------ |
| `findAll(params?)`                 | Returns all rows matching `QueryParams`          |
| `findById(id)`                     | Returns one row or `null`                        |
| `save(data)`                       | Inserts a row, returns the inserted record       |
| `saveAll(data[])`                  | Bulk-inserts rows, returns all inserted records  |
| `updateById(id, data)`             | Replaces a row, throws `NotFound` if missing     |
| `patchById(id, data)`              | Merges into a row, throws `NotFound` if missing  |
| `deleteById(id)`                   | Deletes a row, throws `NotFound` if missing      |
| `count(params?)`                   | Returns the count matching `QueryParams`         |

`save`, `saveAll`, `updateById`, and `patchById` use `RETURNING *` on PostgreSQL, SQLite, and MSSQL. On MySQL/MariaDB they fall back to a follow-up `SELECT`.

#### Custom queries

Use the `db` getter for ad-hoc queries against the table:

```typescript
class UserRepository extends KnexRepository<User> {
  readonly tableName = "users";

  async findByEmail(email: string): Promise<User | null> {
    return (await this.db.where({ email }).first()) ?? null;
  }
}
```

#### Transactions

```typescript
const repo = new UserRepository(app);

await repo.withTransaction(async (txRepo) => {
  const user = await txRepo.save({ name: "Alice", email: "alice@example.com" });
  await txRepo.save({ userId: user.id, role: "admin" });
});
```

`withTransaction` creates a transaction-scoped copy of the repository. All calls inside the callback share the same transaction and roll back automatically on error.

---

### `KnexVectorRepository<T, D>` (pgvector)

Extends `KnexRepository` with `VectorRepository<T>` support on PostgreSQL via [pgvector](https://github.com/pgvector/pgvector). Set `vectorColumn` (default `"embedding"`) and optionally `distanceOperator` (`"<=>"` cosine, `"<->"` L2, `"<#>"` inner product).

Every `findSimilar` result carries the computed pgvector distance as `_score` — **lower is more
similar** (it is a distance, not a similarity, unlike the Pinecone/Qdrant adapters where higher
wins). The same value is mirrored to the deprecated `_distance` field for one release.

---

### `QueryParams` — supported `where` operators

```typescript
// Equality
{ email: "alice@example.com" }

// Null check
{ deletedAt: null }             // IS NULL
{ deletedAt: { $ne: null } }   // IS NOT NULL

// Comparison
{ age: { $gt: 18 } }           // $lt | $lte | $gt | $gte

// Inequality
{ status: { $ne: "banned" } }

// Inclusion
{ role: { $in: ["admin", "editor"] } }
{ role: { $nin: ["guest"] } }

// Pattern matching (PostgreSQL)
{ name: { $like: "Alice%" } }
{ name: { $ilike: "alice%" } }   // case-insensitive
{ name: { $notlike: "Bob%" } }

// Logical
{ $or: [{ role: "admin" }, { role: "editor" }] }
{ $and: [{ active: true }, { age: { $gte: 18 } }] }
```

---

### Error mapping

Database-level errors are translated to typed `MantleError` subclasses:

| PostgreSQL code prefix | Error thrown   |
| ---------------------- | -------------- |
| `08`, `57`             | `Unavailable`  |
| `22`                   | `BadRequest`   |
| `23505` (unique)       | `Conflict`     |
| other `23`             | `BadRequest`   |
| `28`                   | `Forbidden`    |
| `3D`, `3F`, `42`       | `Unprocessable`|
| other                  | `GeneralError` |

## Development

```bash
npx nx build knex    # compile
npx nx test knex     # run tests
npx nx lint knex     # lint
```

## Publishing

Build before publishing:

```bash
npx nx build knex
```

First publish (scoped packages require `--access public`):

```bash
cd packages/knex
npm publish --access public
```

Subsequent releases — bump `version` in `packages/knex/package.json`, then:

```bash
cd packages/knex
npm publish
```

### Testing locally with Verdaccio

```bash
# Terminal 1 — start the local registry
npx nx run @mantle/source:local-registry

# Terminal 2 — publish to it
cd packages/knex
npm publish --registry http://localhost:4873

# Install from it in another project
npm install @mantlejs/knex --registry http://localhost:4873
```
