# @mantlejs/pinecone

Pinecone vector database adapter for [Mantle JS](https://github.com/mantlejs/mantle). Provides `PineconeRepository<T>` — an abstract `Repository<T>` base class that stores entities as Pinecone vectors with metadata.

---

## Installation

```bash
npm install @mantlejs/pinecone @pinecone-database/pinecone
```

---

## Concepts

### Vector storage

Pinecone is a managed vector database. Each record is stored as a high-dimensional float array (the "embedding") plus a metadata object. `PineconeRepository` maps a Mantle entity to a Pinecone vector by serialising all non-`id` fields as metadata and delegating embedding generation to the subclass via `toVector()`.

### Embedding generation

Embeddings are intentionally decoupled from the repository. Subclasses implement `toVector(data)` to call their embedding model of choice (OpenAI, Cohere, a local model, etc.). This keeps the adapter model-agnostic.

### Namespace

A single Pinecone index can be partitioned into isolated namespaces. Pass `namespace` to `PineconeRepositoryOptions` to scope all operations to a namespace. Omit it to use the default namespace.

---

## Quick start

```typescript
import { Pinecone } from "@pinecone-database/pinecone";
import { mantle } from "@mantlejs/mantle";
import { PineconeRepository } from "@mantlejs/pinecone";

const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
const index = pc.index("documents");

interface Document {
  id: string;
  title: string;
  body: string;
}

class DocumentRepository extends PineconeRepository<Document> {
  async toVector(data: Partial<Document>): Promise<number[]> {
    // Call your embedding model here
    const text = [data.title, data.body].filter(Boolean).join(" ");
    return myEmbeddingModel.embed(text);
  }
}

const app = mantle();
const repo = new DocumentRepository({ index, namespace: "prod" });

app.use("/documents", new DocumentService(repo));
app.listen(3030);
```

---

## API

### `PineconeRepository<T, D>` (abstract class)

An abstract base class that implements `Repository<T, D>` for Pinecone.

```typescript
abstract class PineconeRepository<T extends { id: string }, D = Partial<T>> implements Repository<T, D> {
  constructor(options: PineconeRepositoryOptions);
  abstract toVector(data: D): Promise<number[]>;
}
```

Subclasses must implement `toVector()`. All other `Repository<T>` methods are provided as concrete implementations.

#### `PineconeRepositoryOptions`

| Option      | Type     | Default     | Description                               |
| ----------- | -------- | ----------- | ----------------------------------------- |
| `index`     | `Index`  | —           | A Pinecone `Index` instance (required)    |
| `namespace` | `string` | `undefined` | Pinecone namespace to scope operations to |

#### Inherited from `Repository<T, D>`

| Method                 | Description                                              |
| ---------------------- | -------------------------------------------------------- |
| `findAll(params?)`     | List all records, with optional `QueryParams` filtering  |
| `findById(id)`         | Fetch a single record by ID; returns `null` if not found |
| `save(data)`           | Insert a new record (generates embedding via `toVector`) |
| `saveAll(data[])`      | Batch insert multiple records                            |
| `updateById(id, data)` | Replace all metadata for a record                        |
| `patchById(id, data)`  | Update individual metadata fields for a record           |
| `deleteById(id)`       | Delete a record; throws `NotFound` if absent             |
| `count(params?)`       | Count records matching optional `QueryParams`            |

---

## Types

```typescript
import type { PineconeRepositoryOptions } from "@mantlejs/pinecone";
```

| Type                        | Description                                      |
| --------------------------- | ------------------------------------------------ |
| `PineconeRepositoryOptions` | Options for the `PineconeRepository` constructor |

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
