# @mantlejs/pinecone

Pinecone vector database adapter for [Mantle JS](https://github.com/mantlejs/mantle). Provides `PineconeRepository<T>` — an abstract `Repository<T>` base class that stores entities as Pinecone vectors with metadata.

---

## Installation

```bash
npm install @mantlejs/pinecone @pinecone-database/pinecone
```

---

## Concepts

### The `pinecone()` plugin

`pinecone(config)` is a Mantle plugin. It creates a `Pinecone` client (from `@pinecone-database/pinecone`)
and stores it on the application at `app.get("pinecone")`. `PineconeRepository` reads this client from
the app in its constructor, so `.configure(pinecone(...))` must run before any repository is instantiated.

### Vector storage

Pinecone is a managed vector database. Each record is stored as a high-dimensional float array (the "embedding") plus a metadata object. `PineconeRepository` maps a Mantle entity to a Pinecone vector by serialising all non-`idField` fields as metadata.

### Embedding generation

`save()` and `saveAll()` write a **zero-vector placeholder** (sized to `vectorDimension`) — they never
call an embedding model. Attach a real embedding separately with `upsertVector(id, vector, data)`, using
a vector from your embedding model of choice (OpenAI, Cohere, a local model, etc.). This keeps the
adapter model-agnostic: it never generates embeddings itself.

### Namespace

A single Pinecone index can be partitioned into isolated namespaces. Declare `namespace` as a required
property on your repository subclass to scope all operations to that namespace.

---

## Quick start

```typescript
import { mantle } from "@mantlejs/mantle";
import { pinecone, PineconeRepository } from "@mantlejs/pinecone";

interface Document extends Record<string, unknown> {
  id: string;
  title: string;
  body: string;
}

class DocumentRepository extends PineconeRepository<Document> {
  readonly indexName = "documents";
  readonly namespace = "prod";
  readonly vectorDimension = 1536; // must match your embedding model's output size
}

const app = mantle().configure(pinecone({ apiKey: process.env.PINECONE_API_KEY }));

const repo = new DocumentRepository(app);

app.use("/documents", new DocumentService(repo));
app.listen(3030);

// save() only writes a zero-vector placeholder — attach the real embedding separately:
const doc = await repo.save({ title: "Hello", body: "World" });
const vector = await myEmbeddingModel.embed(`${doc.title} ${doc.body}`);
await repo.upsertVector(doc.id, vector, doc);
```

---

## API

### `pinecone(config?)`

Returns a `MantlePlugin`. Call via `app.configure(pinecone(config))`.

```typescript
app.configure(
  pinecone({
    apiKey: process.env.PINECONE_API_KEY, // optional — falls back to the PINECONE_API_KEY env var
  }),
);
```

Side effects:

- Stores the `Pinecone` client at `app.get("pinecone")`

#### `PineconeConfig`

`Partial<PineconeConfiguration>` — every option accepted by the underlying `@pinecone-database/pinecone`
client's constructor (`apiKey`, custom fetch implementation, etc.) is passed straight through.

---

### `PineconeRepository<T, D>` (abstract class)

An abstract base class that implements `VectorRepository<T, D>` for Pinecone. Requires `pinecone()` to
be configured first — the constructor reads the client via `app.get("pinecone")`.

```typescript
abstract class PineconeRepository<T extends Record<string, unknown>, D = Partial<T>>
  implements VectorRepository<T, D>
{
  constructor(app: MantleApplication);

  abstract readonly indexName: string;
  abstract readonly namespace: string;
  abstract readonly vectorDimension: number;
}
```

#### Properties

| Property          | Type      | Default | Description                                                                 |
| ------------------ | --------- | ------- | ----------------------------------------------------------------------------- |
| `indexName`        | `string`  | —       | Pinecone index name **(required)**                                          |
| `namespace`        | `string`  | —       | Pinecone namespace to scope operations to **(required)**                    |
| `vectorDimension`  | `number`  | —       | Vector dimensionality of the index — sizes the zero-vector placeholder written by `save()`/`saveAll()` **(required)** |
| `idField`          | `string`  | `"id"`  | Metadata key that holds the record id                                       |
| `timestamps`       | `boolean` | `true`  | Auto-write `createdAt` / `updatedAt` ISO-8601 strings                       |

#### `VectorRepository<T>` methods

| Method                                 | Description                                                 |
| -------------------------------------- | ----------------------------------------------------------- |
| `findSimilar(vector, topK, params?)`   | ANN search — returns the top-K most similar records         |
| `upsertVector(id, vector, data)`       | Attach (or replace) the embedding for a record              |
| `deleteVector(id)`                     | Delete the record and its embedding (alias for `deleteById`)|

Every `findSimilar` result carries the Pinecone match score as `_score` — **higher is more similar**
(similarity, not distance, for the common `cosine`/`dotproduct` metrics).

#### Inherited from `Repository<T, D>`

| Method                 | Description                                              |
| ---------------------- | -------------------------------------------------------- |
| `findAll(params?)`     | List all records, with optional `QueryParams` filtering  |
| `findPage(params?)`    | One page via Pinecone's native `paginationToken` as the `cursor`. `where`/`skip`/`sort` are rejected with `BadRequest` — the list API cannot filter or order |
| `findById(id)`         | Fetch a single record by ID; returns `null` if not found |
| `save(data)`           | Insert a new record with a **zero-vector placeholder** (sized to `vectorDimension`) — does not generate a real embedding; call `upsertVector()` for that |
| `saveAll(data[])`      | Batch insert multiple records, each with a zero-vector placeholder |
| `updateById(id, data)` | Replace all metadata for a record                        |
| `patchById(id, data)`  | Update individual metadata fields for a record           |
| `deleteById(id)`       | Delete a record; throws `NotFound` if absent             |
| `count(params?)`       | Count records matching optional `QueryParams`            |

---

### `toPineconeFilter(where)`

Converts a Mantle `QueryParams.where` clause into a Pinecone metadata filter object. Used internally by
`findAll()` and `findSimilar()`; exported for writing raw SDK calls inside a custom repository method.

| Operator                          | Pinecone filter                    |
| ---------------------------------- | ----------------------------------- |
| `{ field: value }`                 | `{ field: { $eq: value } }`         |
| `{ field: null }`                  | `{ field: { $eq: null } }`          |
| `{ field: [a, b] }`                | `{ field: { $in: [a, b] } }`        |
| `{ field: { $lt/$lte/$gt/$gte } }` | passed through unchanged            |
| `{ field: { $ne/$in/$nin } }`      | passed through unchanged            |
| `{ $or: [...] }`                   | `{ $or: [mapped…] }`                |
| `{ $and: [...] }`                  | `{ $and: [mapped…] }`               |

`$like` and other pattern-matching operators are unsupported — Pinecone metadata filters have no
wildcard matching — and throw `BadRequest` naming the operator.

```typescript
import { toPineconeFilter } from "@mantlejs/pinecone";

const filter = toPineconeFilter({ category: "docs", views: { $gt: 100 } });
// { category: { $eq: "docs" }, views: { $gt: 100 } }
```

---

## Types

```typescript
import type { PineconeConfig, WhereClause } from "@mantlejs/pinecone";
```

| Type            | Description                                       |
| ---------------- | -------------------------------------------------- |
| `PineconeConfig` | Options passed to `pinecone()`                    |
| `WhereClause`    | Input type for `toPineconeFilter()`               |

---

## Development

```bash
npx nx build pinecone    # compile
npx nx test pinecone     # run tests
npx nx lint pinecone     # lint
```

---

## Publishing

Build before publishing:

```bash
npx nx build pinecone
```

First publish (scoped packages require `--access public`):

```bash
cd packages/pinecone
npm publish --access public
```

Subsequent releases — bump `version` in `packages/pinecone/package.json`, then:

```bash
cd packages/pinecone
npm publish
```

### Testing locally with Verdaccio

```bash
# Terminal 1 — start the local registry
npx nx run @mantle/source:local-registry

# Terminal 2 — publish to it
cd packages/pinecone
npm publish --registry http://localhost:4873

# Install from it in another project
npm install @mantlejs/pinecone --registry http://localhost:4873
```
