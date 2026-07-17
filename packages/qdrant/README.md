# @mantlejs/qdrant

Qdrant vector database adapter for [Mantle JS](https://github.com/mantlejs/mantle). Provides `QdrantRepository<T>` — an abstract `VectorRepository<T>` base class that stores entities as Qdrant points with payload metadata and auto-creates collections on first write.

---

## Installation

```bash
npm install @mantlejs/qdrant @qdrant/js-client-rest
```

---

## Concepts

### Vector storage

Qdrant is an open-source, self-hosted vector database optimised for high-performance similarity search. Each record is stored as a Qdrant point: a high-dimensional float array (the embedding) plus a JSON payload. `QdrantRepository` maps a Mantle entity to a Qdrant point by using the entity `id` as the point ID and serialising all other fields as the point payload.

### Zero-vector placeholders

Embedding generation is intentionally decoupled from the repository. Calling `save()` or `saveAll()` inserts a zero-vector placeholder so the record is immediately findable by payload filters. Call `upsertVector(id, vector, data)` to attach the real embedding once it is available.

### Collections

A Qdrant database is organised into named collections. Subclasses declare `readonly collectionName: string`. The collection is created automatically with cosine-distance configuration on the first write — no manual setup required for development or testing.

---

## Quick start

```typescript
import { mantle } from "@mantlejs/mantle";
import { qdrant, QdrantRepository } from "@mantlejs/qdrant";

const app = mantle().configure(
  qdrant({ url: process.env.QDRANT_URL, apiKey: process.env.QDRANT_API_KEY }),
);

interface Document extends Record<string, unknown> {
  id: string;
  title: string;
  body: string;
}

class DocumentRepository extends QdrantRepository<Document> {
  readonly collectionName = "documents";
  readonly vectorSize = 1536; // must match the embedding model output
}

const repo = new DocumentRepository(app);

// Insert a record (zero-vector placeholder)
const doc = await repo.save({ title: "Intro to Qdrant", body: "..." });

// Attach a real embedding once generated
await repo.upsertVector(doc.id, embeddingVector, { title: doc.title, body: doc.body });

// Similarity search
const similar = await repo.findSimilar(queryVector, 10, { where: { body: { $like: "Qdrant" } } });
```

---

## API

### `qdrant(config?)`

Returns a `MantlePlugin`. Call via `app.configure(qdrant(config))`.

```typescript
app.configure(
  qdrant({
    url: process.env.QDRANT_URL,       // optional — default "http://localhost:6333"
    apiKey: process.env.QDRANT_API_KEY, // optional — for Qdrant Cloud
  }),
);
```

Side effects:

- Creates a `QdrantClient` and stores it at `app.get("qdrant")`

#### `QdrantConfig`

| Field    | Type     | Default                                     | Description                               |
| -------- | -------- | ------------------------------------------- | ----------------------------------------- |
| `url`    | `string` | `QDRANT_URL` env or `http://localhost:6333` | Qdrant server URL                         |
| `apiKey` | `string` | `QDRANT_API_KEY` env                        | API key for Qdrant Cloud (omit for local) |

All other fields are passed through to `QdrantClient` from `@qdrant/js-client-rest`.

---

### `QdrantRepository<T, D>` (abstract class)

Implements `VectorRepository<T, D>` for Qdrant.

```typescript
abstract class QdrantRepository<T extends Record<string, unknown>, D = Partial<T>>
  implements VectorRepository<T, D> {
  abstract readonly collectionName: string;
  abstract readonly vectorSize: number;
}
```

Subclasses must declare `collectionName` and `vectorSize`. All `VectorRepository<T>` and `Repository<T>` methods are provided as concrete implementations.

#### `VectorRepository<T>` methods

| Method                                 | Description                                                 |
| -------------------------------------- | ----------------------------------------------------------- |
| `findSimilar(vector, topK, params?)`   | ANN search — returns the top-K most similar records         |
| `upsertVector(id, vector, data)`       | Attach (or replace) the embedding for a record              |
| `deleteVector(id)`                     | Delete the record and its embedding (alias for `deleteById`)|

Every `findSimilar` result carries the Qdrant match score as `_score`. **Higher is more similar** for
`Cosine` and `Dot` collections (the default here is `Cosine`); for `Euclid` collections Qdrant reports a
distance, where lower is more similar.

#### `Repository<T>` methods

| Method                 | Description                                              |
| ---------------------- | -------------------------------------------------------- |
| `findAll(params?)`     | Scroll through records with optional filtering & sorting |
| `findPage(params?)`    | One page via native scroll cursors — pass the returned `cursor` back for the next page. `skip`/`sort` are rejected with `BadRequest` (Qdrant cannot combine `order_by` with scroll cursors) |
| `findById(id)`         | Fetch a single record by ID; returns `null` if not found |
| `save(data)`           | Insert with a zero-vector placeholder                    |
| `saveAll(data[])`      | Batch insert (single Qdrant upsert call)                 |
| `updateById(id, data)` | Replace the full payload, preserving the stored vector   |
| `patchById(id, data)`  | Merge partial fields, preserving the stored vector       |
| `deleteById(id)`       | Delete a record; throws `NotFound` if absent             |
| `count(params?)`       | Exact count of records matching optional `QueryParams`   |

#### Instance properties

| Property        | Type      | Default | Description                                  |
| --------------- | --------- | ------- | -------------------------------------------- |
| `collectionName`| `string`  | —       | **Required.** Qdrant collection name         |
| `vectorSize`    | `number`  | —       | **Required.** Embedding dimensionality       |
| `idField`       | `string`  | `"id"`  | Payload key used as the point ID             |
| `timestamps`    | `boolean` | `true`  | Auto-write `createdAt` / `updatedAt` fields  |

#### `QueryParams.where` operators

| Mantle operator     | Qdrant filter                       |
| ------------------- | ----------------------------------- |
| `{ field: value }`  | `match.value`                       |
| `{ field: null }`   | `is_null`                           |
| `{ field: [a, b] }` | `match.any`                         |
| `$gt / $gte / $lt / $lte` | `range`                      |
| `$ne`               | `must_not match.value`              |
| `$ne: null`         | `must_not is_null`                  |
| `$in`               | `match.any`                         |
| `$nin`              | `must_not match.any`                |
| `$like / $ilike`    | `match.text`                        |
| `$notlike`          | `must_not match.text`               |
| `$or`               | `should`                            |
| `$and`              | `must`                              |

---

## Types

```typescript
import type { QdrantConfig, WhereClause } from "@mantlejs/qdrant";
```

| Type           | Description                           |
| -------------- | ------------------------------------- |
| `QdrantConfig` | Options passed to `qdrant()` plugin   |
| `WhereClause`  | `QueryParams.where` clause type       |

---

## Development

```bash
npx nx build qdrant    # compile
npx nx test qdrant     # run tests
npx nx lint qdrant     # lint
```

---

## Publishing

Build before publishing:

```bash
npx nx build qdrant
```

First publish (scoped packages require `--access public`):

```bash
cd packages/qdrant
npm publish --access public
```

Subsequent releases — bump `version` in `packages/qdrant/package.json`, then:

```bash
cd packages/qdrant
npm publish
```
