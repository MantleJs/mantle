# @mantlejs/embeddings

Auto-embed-on-write hook for [Mantle JS](https://github.com/mantlejs/mantle). Calls a pluggable embedding provider and upserts the result into a `VectorRepository<T>` after a create/update/patch — "one line instead of a hand-written trigger."

---

## Installation

```bash
npm install @mantlejs/embeddings
```

---

## Concepts

### Why this package exists

`@mantlejs/pinecone`, `@mantlejs/qdrant`, `@mantlejs/mongodb`'s `MongoVectorRepository`, and `@mantlejs/knex`'s `KnexVectorRepository` are all deliberately model-agnostic: the caller must always supply an already-computed `number[]` vector — none of them generates an embedding from source text. `embed()` is the missing "text in, vector attached" step, as a hook rather than something every service hand-rolls in its own `create`/`update`/`patch` methods.

### Bring your own provider

`@mantlejs/embeddings` never bundles a specific embedding model — no OpenAI/Cohere/etc. SDK dependency. `EmbeddingProvider` is a one-method interface:

```typescript
interface EmbeddingProvider {
  dimensions?: number;
  embed(text: string): Promise<number[]>;
}
```

Wrap whichever provider you use behind it — an HTTP call to an embedding API, a local model, or (for demos) a deterministic hash-based stand-in.

### The cross-adapter write-consistency pattern, made concrete

See the root [README's "Services with multiple repositories"](../../README.md#services-with-multiple-repositories) section for the general pattern; `embed()` is its reference implementation:

- **Idempotent, keyed on the source record's id.** `upsertVector(id, vector, data)` is an upsert on every adapter — re-running `embed()` for the same id (a retry, or a second edit) replaces the vector at that id rather than duplicating it. This comes from the adapter contract, not from anything `embed()` does itself.
- **Safe to retry.** Because it's an idempotent upsert, calling it again after a partial failure is always safe.
- **Non-fatal on failure.** A provider error or a vector-store error is caught inside the hook and never rethrown — the primary write already succeeded (or already failed for its own reason), and a degraded embedding provider must never turn that into a failed request for the caller.

### Attach after create/update/patch — never after find/get/remove

`embed()` reads the just-written record off `ctx.result`. Attach it to `after.create`/`after.update`/`after.patch`, where a freshly-written single record is guaranteed to be there. It's a no-op (skips) if `ctx.result` is an array or a paginated page — i.e. it's safe to *not* worry about accidentally attaching it to `after.find`, but there's still nothing useful for it to do there.

---

## Quick start

```typescript
import { mantle } from "@mantlejs/mantle";
import { http } from "@mantlejs/http";
import { knex, KnexVectorRepository } from "@mantlejs/knex";
import { embed } from "@mantlejs/embeddings";
import type { EmbeddingProvider } from "@mantlejs/embeddings";

const app = mantle()
  .configure(http())
  .configure(knex({ client: "pg", connection: process.env.DATABASE_URL }));

class ArticleVectorRepository extends KnexVectorRepository<Article> {
  readonly tableName = "articles";
  readonly vectorColumn = "embedding";
}

const provider: EmbeddingProvider = {
  dimensions: 1536,
  async embed(text) {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "text-embedding-3-small", input: text }),
    });
    const { data } = await res.json();
    return data[0].embedding;
  },
};

const articleVectors = new ArticleVectorRepository(app);
const embedArticle = embed({ vectors: articleVectors, provider, field: ["title", "body"] });

app.use("articles", new ArticleService(new ArticleRepository(app)));
app.service("articles").hooks({
  after: {
    create: [embedArticle],
    update: [embedArticle],
    patch: [embedArticle],
  },
});
```

---

## API

### `embed(options)`

Returns a `HookFunction<T>`.

| Field      | Type                                                        | Default | Description                                                                             |
| ---------- | ------------------------------------------------------------ | ------- | ----------------------------------------------------------------------------------------- |
| `vectors`  | `VectorRepository<T>`                                        | —       | Where the computed embedding is upserted (required)                                     |
| `provider` | `EmbeddingProvider`                                           | —       | Called with the extracted text to produce the vector (required)                         |
| `field`    | `keyof T \| Array<keyof T> \| ((record: T) => string)`         | —       | Source text: one field, several fields joined with `"\n"`, or a function (required)      |
| `onError`  | `(error, record, ctx) => void`                                | logs via `app.get<Logger>("logger")` | Called when extraction, the provider, or the upsert throws. Never fails the primary write. |

### `EmbeddingProvider`

```typescript
interface EmbeddingProvider {
  dimensions?: number;
  embed(text: string): Promise<number[]>;
}
```

---

## Types

```typescript
import type { EmbedOptions, EmbeddingProvider } from "@mantlejs/embeddings";
```

| Type               | Description                          |
| ------------------ | --------------------------------------- |
| `EmbedOptions<T>`  | Options passed to `embed()`             |
| `EmbeddingProvider` | The pluggable text-to-vector contract |

---

## Development

```bash
npx nx build embeddings   # compile
npx nx test embeddings    # run tests
npx nx lint embeddings    # lint
```

---

## Publishing

Build before publishing:

```bash
npx nx build embeddings
```

First publish (scoped packages require `--access public`):

```bash
cd packages/embeddings
npm publish --access public
```

Subsequent releases — bump `version` in `packages/embeddings/package.json`, then:

```bash
cd packages/embeddings
npm publish
```

### Testing locally with Verdaccio

```bash
# Terminal 1 — start the local registry
npx nx run @mantle/source:local-registry

# Terminal 2 — publish to it
cd packages/embeddings
npm publish --registry http://localhost:4873
```
