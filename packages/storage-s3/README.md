# @mantlejs/storage-s3

AWS S3 storage adapter for [`@mantlejs/storage`](../storage/README.md). Uploads files to an S3 bucket using the official AWS SDK v3 with multipart support for files of any size.

---

## Installation

```bash
npm install @mantlejs/storage-s3 @aws-sdk/client-s3 @aws-sdk/lib-storage
```

---

## Concepts

### StorageAdapter

`@mantlejs/storage` delegates file persistence to a `StorageAdapter`. This package provides `s3Storage()` — a factory that returns an adapter wired to an S3 bucket. Pass it as the `storage` option when calling `upload()`.

### Multipart upload

The adapter uses `@aws-sdk/lib-storage` `Upload`, which automatically handles multipart uploads for large files and single-part uploads for smaller ones. The incoming `Readable` stream is piped directly — no buffering into memory.

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

`UploadedFile.path` after upload: `https://{bucket}.s3.{region}.amazonaws.com/{key}`

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
