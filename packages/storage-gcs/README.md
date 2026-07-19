# @mantlejs/storage-gcs

Google Cloud Storage adapter for [`@mantlejs/storage`](../storage/README.md). Uploads files to a GCS bucket using the official `@google-cloud/storage` SDK, streaming directly without buffering into memory.

---

## Installation

```bash
npm install @mantlejs/storage-gcs @google-cloud/storage
```

---

## Concepts

### StorageAdapter

`@mantlejs/storage` delegates file persistence to a `StorageAdapter`. This package provides `gcsStorage()` — a factory that returns an adapter wired to a GCS bucket. Pass it as the `storage` option when calling `upload()`.

### Streaming upload

The adapter pipes the incoming `Readable` stream directly into a GCS write stream via `file.createWriteStream()`. No temporary files or in-memory buffering — memory usage stays flat regardless of file size.

### Read, delete, and signed URLs

Beyond `store()`, the adapter implements the rest of the `StorageAdapter` interface: `retrieve(key)` returns `file.createReadStream()`, `delete(key)` removes the object (mapping a 404 to `NotFound`), and `getSignedUrl(key, options?)` returns a v4 signed URL via `file.getSignedUrl()`. All three take the exact `key` value returned on `UploadedFile.key` from `store()`.

---

## Quick start

```typescript
import { mantle } from "@mantlejs/mantle";
import { express } from "@mantlejs/express";
import { upload } from "@mantlejs/storage";
import { gcsStorage } from "@mantlejs/storage-gcs";

const app = mantle()
  .configure(express())
  .configure(
    upload({
      storage: gcsStorage({
        bucket: process.env.GCS_BUCKET!,
        keyPrefix: "uploads/",
      }),
      maxFileSize: 10 * 1024 * 1024, // 10 MB
      allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
    }),
  );
```

**Use in a service hook:**

```typescript
import { handleUpload } from "@mantlejs/storage";

app.service("avatars").hooks({
  before: {
    create: [handleUpload("file")],
  },
});
```

**Custom key (timestamp + original name):**

```typescript
gcsStorage({
  bucket: "my-bucket",
  key: (info) => `media/${Date.now()}-${info.originalname}`,
});
```

**Explicit service-account key file:**

```typescript
gcsStorage({
  bucket: "my-bucket",
  projectId: "my-gcp-project",
  keyFilename: "/path/to/service-account-key.json",
});
```

**Public objects (HTTPS URL in `UploadedFile.path`):**

```typescript
gcsStorage({
  bucket: "my-public-bucket",
  public: true,
});
```

**Private objects (default, `gs://` URI in `UploadedFile.path`):**

```typescript
gcsStorage({
  bucket: "my-private-bucket",
  // public: false (default)
});
```

**Retrieve, delete, and generate a signed URL:**

```typescript
const storage = gcsStorage({ bucket: "my-bucket" });
const uploaded = await storage.store(stream, info);

const readStream = await storage.retrieve(uploaded.key);
const url = await storage.getSignedUrl(uploaded.key, { expiresIn: 300 }); // 5 minutes
await storage.delete(uploaded.key);
```

---

## API

### `gcsStorage(config)`

Returns a `GcsStorageAdapter` that implements the `StorageAdapter` interface from `@mantlejs/storage`.

```typescript
import { gcsStorage } from "@mantlejs/storage-gcs";

const storage = gcsStorage({
  bucket: "my-bucket",
});
```

#### `GcsStorageConfig`

| Field         | Type                               | Default                         | Description                                                           |
| ------------- | ---------------------------------- | ------------------------------- | --------------------------------------------------------------------- |
| `bucket`      | `string`                           | —                               | GCS bucket name (required)                                            |
| `projectId`   | `string`                           | ADC default                     | GCP project ID                                                        |
| `keyFilename` | `string`                           | Application Default Credentials | Path to a service-account key JSON file                               |
| `keyPrefix`   | `string`                           | `""`                            | Prefix prepended to every generated object name, e.g. `"uploads/"`   |
| `public`      | `boolean`                          | `false`                         | When `true`, makes the object public-read and returns an HTTPS URL    |
| `key`         | `(file: UploadFileInfo) => string` | `<keyPrefix><timestamp>-<name>` | Fully override the object name from file metadata                     |

`UploadedFile.path` after upload:
- `public: true` → `https://storage.googleapis.com/{bucket}/{key}`
- `public: false` → `gs://{bucket}/{key}` (use for signed URL generation or server-side access)

`UploadedFile.key` is the resolved GCS object name — pass it back into `retrieve()`, `delete()`, or `getSignedUrl()`.

---

### `GcsStorageAdapter#retrieve(key)`

Returns the object's `Readable` via `file.createReadStream()`.

### `GcsStorageAdapter#delete(key)`

Removes the object via `file.delete()`. Throws `NotFound` if the underlying GCS API responds with a 404.

### `GcsStorageAdapter#getSignedUrl(key, options?)`

Returns a v4 signed read URL via `file.getSignedUrl()`.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `expiresIn` | `number` | `900` (15 minutes) | URL validity window, in seconds |

---

## Types

```typescript
import type { GcsStorageConfig } from "@mantlejs/storage-gcs";
import { GcsStorageAdapter, gcsStorage } from "@mantlejs/storage-gcs";
```

| Export              | Kind     | Description                                     |
| ------------------- | -------- | ----------------------------------------------- |
| `gcsStorage`        | function | Factory — returns a `GcsStorageAdapter`         |
| `GcsStorageAdapter` | class    | The adapter class (implements `StorageAdapter`) |
| `GcsStorageConfig`  | type     | Configuration passed to `gcsStorage()`          |

---

## Development

```bash
npx nx build storage-gcs   # compile
npx nx test storage-gcs    # run tests
npx nx lint storage-gcs    # lint
```

---

## Publishing

Build before publishing:

```bash
npx nx build storage-gcs
```

First publish (scoped packages require `--access public`):

```bash
cd packages/storage-gcs
npm publish --access public
```

Subsequent releases — bump `version` in `packages/storage-gcs/package.json`, then:

```bash
cd packages/storage-gcs
npm publish
```
