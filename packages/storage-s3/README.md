# @mantlejs/storage-s3

AWS S3 storage adapter for [`@mantlejs/storage`](../storage/README.md). Uploads files to an S3 bucket using the official AWS SDK v3 with multipart support for files of any size.

---

## Installation

```bash
npm install @mantlejs/storage-s3 @aws-sdk/client-s3 @aws-sdk/lib-storage @aws-sdk/s3-request-presigner
```

---

## Concepts

### StorageAdapter

`@mantlejs/storage` delegates file persistence to a `StorageAdapter`. This package provides `s3Storage()` — a factory that returns an adapter wired to an S3 bucket. Pass it as the `storage` option when calling `upload()`.

### Multipart upload

The adapter uses `@aws-sdk/lib-storage` `Upload`, which automatically handles multipart uploads for large files and single-part uploads for smaller ones. The incoming `Readable` stream is piped directly — no buffering into memory.

### Read, delete, and signed URLs

Beyond `store()`, the adapter implements the rest of the `StorageAdapter` interface: `retrieve(key)` streams an object back via `GetObjectCommand`, `delete(key)` removes it via `DeleteObjectCommand`, and `getSignedUrl(key, options?)` returns a time-limited download URL via `@aws-sdk/s3-request-presigner`. All three take the exact `key` value returned on `UploadedFile.key` from `store()`.

---

## Quick start

```typescript
import { mantle } from "@mantlejs/mantle";
import { express } from "@mantlejs/express";
import { upload } from "@mantlejs/storage";
import { s3Storage } from "@mantlejs/storage-s3";

const app = mantle()
  .configure(express())
  .configure(
    upload({
      storage: s3Storage({
        bucket: process.env.S3_BUCKET!,
        region: process.env.AWS_REGION!,
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
s3Storage({
  bucket: "my-bucket",
  region: "us-east-1",
  key: (info) => `media/${Date.now()}-${info.originalname}`,
});
```

**Explicit credentials (CI / non-default credential chain):**

```typescript
s3Storage({
  bucket: "my-bucket",
  region: "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});
```

**Public-read objects:**

```typescript
s3Storage({
  bucket: "my-public-bucket",
  region: "us-east-1",
  acl: "public-read",
});
```

**Retrieve, delete, and generate a signed URL:**

```typescript
const storage = s3Storage({ bucket: "my-bucket", region: "us-east-1" });
const uploaded = await storage.store(stream, info);

const readStream = await storage.retrieve(uploaded.key);
const url = await storage.getSignedUrl(uploaded.key, { expiresIn: 300 }); // 5 minutes
await storage.delete(uploaded.key);
```

---

## API

### `s3Storage(config)`

Returns an `S3StorageAdapter` that implements the `StorageAdapter` interface from `@mantlejs/storage`.

```typescript
import { s3Storage } from "@mantlejs/storage-s3";

const storage = s3Storage({
  bucket: "my-bucket",
  region: "us-east-1",
});
```

#### `S3StorageConfig`

| Field         | Type                                | Default                           | Description                                               |
| ------------- | ----------------------------------- | --------------------------------- | --------------------------------------------------------- |
| `bucket`      | `string`                            | —                                 | S3 bucket name (required)                                 |
| `region`      | `string`                            | —                                 | AWS region, e.g. `"us-east-1"` (required)                |
| `credentials` | `{ accessKeyId, secretAccessKey }`  | AWS SDK default credential chain  | Explicit AWS credentials                                  |
| `keyPrefix`   | `string`                            | `""`                              | Prefix prepended to every generated key, e.g. `"uploads/"` |
| `acl`         | `"private" \| "public-read"`        | —                                 | Canned ACL applied to each upload                        |
| `key`         | `(file: UploadFileInfo) => string`  | `<keyPrefix><timestamp>-<name>`   | Fully override the object key from file metadata          |

`UploadedFile.path` after upload: `https://{bucket}.s3.{region}.amazonaws.com/{key}`. `UploadedFile.key` is the resolved S3 object key — pass it back into `retrieve()`, `delete()`, or `getSignedUrl()`.

---

### `S3StorageAdapter#retrieve(key)`

Fetches the object via `GetObjectCommand` and returns its body as a `Readable`. Throws `NotFound` if the object does not exist.

### `S3StorageAdapter#delete(key)`

Removes the object via `DeleteObjectCommand`. S3 deletes are idempotent — deleting a key that doesn't exist does not throw.

### `S3StorageAdapter#getSignedUrl(key, options?)`

Returns a presigned GET URL via `@aws-sdk/s3-request-presigner`.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `expiresIn` | `number` | `900` (15 minutes) | URL validity window, in seconds |

---

## Types

```typescript
import type { S3StorageConfig } from "@mantlejs/storage-s3";
import { S3StorageAdapter, s3Storage } from "@mantlejs/storage-s3";
```

| Export             | Kind     | Description                                     |
| ------------------ | -------- | ----------------------------------------------- |
| `s3Storage`        | function | Factory — returns an `S3StorageAdapter`         |
| `S3StorageAdapter` | class    | The adapter class (implements `StorageAdapter`) |
| `S3StorageConfig`  | type     | Configuration passed to `s3Storage()`           |

---

## Development

```bash
npx nx build storage-s3   # compile
npx nx test storage-s3    # run tests
npx nx lint storage-s3    # lint
```

---

## Publishing

Build before publishing:

```bash
npx nx build storage-s3
```

First publish (scoped packages require `--access public`):

```bash
cd packages/storage-s3
npm publish --access public
```

Subsequent releases — bump `version` in `packages/storage-s3/package.json`, then:

```bash
cd packages/storage-s3
npm publish
```
