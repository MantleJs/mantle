# @mantlejs/mongodb

MongoDB adapter for [Mantle JS](https://github.com/mantlejs/mantle). Provides `MongoRepository<T>` — an abstract `Repository<T>` base class over the official MongoDB Node.js driver (no Mongoose) — and `MongoVectorRepository<T>`, a `VectorRepository<T>` implementation on top of **MongoDB Atlas Vector Search**. Primary deployment target is MongoDB Atlas; works unchanged against any MongoDB 6+ server.

---

## Installation

```bash
npm install @mantlejs/mongodb mongodb
```

---

## Concepts

### Document storage

MongoDB stores records as BSON documents in named collections. Mongo's native `_id` is an `ObjectId`; `MongoRepository` accepts and returns `id` as a `string` (24-char hex) at the `Repository<T>` boundary, converting to/from `ObjectId` internally — services and hooks never see a raw `ObjectId`. Malformed ids are rejected with `BadRequest`.

### Collections

Subclasses declare `readonly collectionName: string`. Collections are created lazily by MongoDB on first write — no manual setup required for development or testing.

### Query translation

Mantle `QueryParams.where` operators map almost directly onto MongoDB query operators — `$lt`/`$lte`/`$gt`/`$gte`/`$ne`/`$in`/`$nin`/`$or`/`$and` are native MongoDB syntax already, and dot-path keys (`"metadata.owner.name"`) are native too. `$contains` is translated to jsonb-`@>`-equivalent MongoDB conditions. `$like`/`$ilike`/`$notlike` are **not** supported (PostgreSQL-only) and throw `BadRequest` — use the raw `collection` escape hatch with `$regex` for pattern matching. Unsupported operators are rejected loudly via `assertOperators`.

### Vector search (Atlas)

`MongoVectorRepository` implements Mantle's `VectorRepository<T>` (`findSimilar` / `upsertVector` / `deleteVector`) via the `$vectorSearch` aggregation stage. This is an **Atlas feature**, not core MongoDB — it requires an Atlas cluster (the free M0 tier works) and an [Atlas Vector Search index](https://www.mongodb.com/docs/atlas/atlas-vector-search/vector-search-type/) on the collection. Fields you want to filter on in `findSimilar` must be declared as `type: "filter"` in that index. Register it with `VectorRepositoryService` from `@mantlejs/mantle` to expose `POST /<path>/similar`, exactly like the Pinecone/Qdrant adapters.

### Transactions

`withTransaction()` runs a block of repository calls inside one MongoDB session/transaction via `client.startSession().withTransaction()`. This requires the deployment to be a replica set — true for every Atlas cluster including free-tier M0. Standalone self-hosted MongoDB without a replica set throws the driver's native error; this is a deployment requirement, not something Mantle works around.

---

## Quick start

```typescript
import { mantle } from "@mantlejs/mantle";
import { mongodb, MongoRepository } from "@mantlejs/mongodb";

const app = mantle().configure(mongodb({ uri: process.env.MONGODB_URI!, dbName: "app" }));

interface User extends Record<string, unknown> {
  id: string;
  name: string;
  email: string;
}

class UserRepository extends MongoRepository<User> {
  readonly collectionName = "users";

  // Escape hatch — driver-native queries via this.collection
  async findByEmailDomain(domain: string): Promise<User[]> {
    const docs = await this.collection.find({ email: { $regex: `@${domain}$` } }).toArray();
    return docs.map((doc) => this.fromDocument(doc));
  }
}

const repo = new UserRepository(app);

const user = await repo.save({ name: "Alice", email: "alice@example.com" });
const admins = await repo.findAll({ where: { role: "admin" }, sort: { name: "asc" }, limit: 10 });

// Transaction (requires a replica set / Atlas)
await repo.withTransaction(async (txRepo) => {
  const alice = await txRepo.save({ name: "Alice", email: "alice@example.com" });
  await txRepo.patchById(alice.id, { name: "Alice A." });
});
```

### Vector search quick start

```typescript
import { VectorRepositoryService } from "@mantlejs/mantle";
import { MongoVectorRepository } from "@mantlejs/mongodb";

interface Doc extends Record<string, unknown> {
  id: string;
  text: string;
  category: string;
}

class DocRepository extends MongoVectorRepository<Doc> {
  readonly collectionName = "docs";
  override readonly vectorIndexName = "docs_vector_index"; // Atlas Vector Search index name
  override readonly vectorField = "embedding"; // field the index covers
}

const docs = new DocRepository(app);

await docs.upsertVector(id, embedding, { text: "MongoDB is a document database", category: "db" });

// Top-5 nearest neighbours, optionally pre-filtered ("category" must be a filter field in the index)
const hits = await docs.findSimilar(queryEmbedding, 5, { where: { category: "db" } });
// → [{ id, text, category, _score: 0.97 }, …]  — HIGHER _score is more similar

// Or expose it as a service: POST /docs/similar { "vector": [...], "topK": 5 }
app.use("docs", new VectorRepositoryService(docs), {
  methods: ["find", "get", "create", "update", "patch", "remove", "similar"],
});
```

---

## API

### `mongodb(config)`

Returns a `MantlePlugin`. Call via `app.configure(mongodb(config))`.

```typescript
app.configure(mongodb({ uri: "mongodb+srv://…", dbName: "app" }));
```

Side effects:

- Creates one `MongoClient` (connects lazily on first operation) and stores it at `app.get("mongoClient")`
- Stores the target `Db` at `app.get("mongoDb")`
- Wraps `app.teardown()` to close the client

#### `MongoConfig`

| Field           | Type                 | Default | Description                                          |
| --------------- | -------------------- | ------- | ---------------------------------------------------- |
| `uri`           | `string`             | —       | Atlas or self-hosted connection string (required)    |
| `dbName`        | `string`             | —       | Database to open collections against (required)      |
| `clientOptions` | `MongoClientOptions` | `{}`    | Full driver options (TLS, pool sizing) — passthrough |

---

### `MongoRepository<T, D>` (abstract class)

Implements `Repository<T, D>` for MongoDB. Subclasses must declare `collectionName`.

| Method                 | Description                                                             |
| ---------------------- | ----------------------------------------------------------------------- |
| `findAll(params?)`     | Query documents with filtering, sorting, offset pagination, projection  |
| `findById(id)`         | Fetch a single record by id; returns `null` if not found                |
| `save(data)`           | Insert a document (`_id` auto-generated unless `data.id` is given)      |
| `saveAll(data[])`      | Batch insert (single `insertMany` call)                                 |
| `updateById(id, data)` | Replace the full document (`findOneAndReplace`)                         |
| `patchById(id, data)`  | Merge partial fields (`$set`); `undefined` values are dropped           |
| `deleteById(id)`       | Delete a record and return it; throws `NotFound` if absent              |
| `count(params?)`       | Count documents matching optional `QueryParams`                         |
| `withTransaction(fn)`  | Run repository calls in one MongoDB transaction (replica set required)  |
| `describe()`           | `RepositoryCapabilities` — adapter name, operator set, pagination style |

#### Instance properties

| Property         | Type         | Default | Description                                                     |
| ---------------- | ------------ | ------- | --------------------------------------------------------------- |
| `collectionName` | `string`     | —       | Collection to target (abstract — must be declared)              |
| `timestamps`     | `boolean`    | `true`  | Maintain `createdAt`/`updatedAt` as BSON `Date` fields          |
| `collection`     | `Collection` | —       | Protected escape hatch — the driver collection (`$regex`, agg…) |

#### `QueryParams.where` operators

Equality, `null`, `$lt`, `$lte`, `$gt`, `$gte`, `$ne`, `$in`, `$nin`, `$or`, `$and`, `$contains`, and dot-path keys. `$contains` follows the shared jsonb-`@>` conformance semantics (`NESTED_QUERY_CASES` in `@mantlejs/mantle`): scalar operand → array-element match, array operand → `$all`, object operand → recursive dot-path superset. `$like`/`$ilike`/`$notlike` throw `BadRequest`.

---

### `MongoVectorRepository<T, D>` (abstract class)

Extends `MongoRepository<T, D>` and implements `VectorRepository<T, D>` via Atlas Vector Search.

#### `VectorRepository<T>` methods

| Method                               | Description                                                                                                              |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `findSimilar(vector, topK, params?)` | `$vectorSearch` top-K nearest neighbours; results carry `_score` (higher = more similar) and exclude the embedding field |
| `upsertVector(id, vector, data)`     | Upsert a record with its embedding (`findOneAndUpdate` + `upsert`)                                                       |
| `deleteVector(id)`                   | Delete the record (and its embedding) — same as `deleteById`                                                             |

#### Additional instance properties

| Property              | Type     | Default          | Description                                                             |
| --------------------- | -------- | ---------------- | ----------------------------------------------------------------------- |
| `vectorIndexName`     | `string` | `"vector_index"` | Name of the Atlas Vector Search index on this collection                |
| `vectorField`         | `string` | `"embedding"`    | Document field storing the embedding                                    |
| `candidateMultiplier` | `number` | `10`             | ANN pool: `numCandidates = topK × multiplier` (capped at Atlas's 10000) |

---

## Types

```typescript
import type { MongoConfig, WhereClause } from "@mantlejs/mongodb";
import { MONGO_OPERATORS, toMongoFilter, toMongoSort, toMongoProjection } from "@mantlejs/mongodb";
```

| Export              | Description                                                      |
| ------------------- | ---------------------------------------------------------------- |
| `MongoConfig`       | Options passed to the `mongodb()` plugin                         |
| `MONGO_OPERATORS`   | Exactly the `$`-operators the where-clause translator accepts    |
| `toMongoFilter`     | `QueryParams.where` → MongoDB filter document translator         |
| `toMongoSort`       | `QueryParams.sort` → MongoDB sort document (`asc`/`desc` → 1/-1) |
| `toMongoProjection` | `QueryParams.select` → MongoDB inclusion projection              |

---

## Development

```bash
npx nx build mongodb    # compile
npx nx test mongodb     # run tests
npx nx lint mongodb     # lint
```

---

## Publishing

Build before publishing:

```bash
npx nx build mongodb
```

First publish (scoped packages require `--access public`):

```bash
cd packages/mongodb
npm publish --access public
```

Subsequent releases — bump `version` in `packages/mongodb/package.json`, then:

```bash
cd packages/mongodb
npm publish
```
