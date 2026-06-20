# @mantlejs/upload

File upload plugin for [Mantle JS](https://github.com/mantlejs/mantle). Parses `multipart/form-data` requests via [busboy](https://github.com/mscdex/busboy), writes files to local disk (or a custom adapter), validates MIME types and file sizes, and attaches uploaded file metadata to `context.data` through a `before` hook.

---

## Installation

```bash
npm install @mantlejs/upload busboy
```

---

## Concepts

### Plugin + hook model

`upload()` is a Mantle plugin that stores upload configuration on the app. It does **not** parse uploads by itself — parsing happens in the `handleUpload()` **before hook**, which you attach to whichever service methods accept files.

### Storage adapters

The built-in `diskStorage()` adapter writes files to a local directory. The `StorageAdapter` interface is intentionally thin, so cloud adapters (S3, GCS) can be plugged in via the `storage` option. Cloud adapters are planned for Phase 2.

### How files reach the hook

The `@mantlejs/express` transport puts the raw `IncomingMessage` at `params.request`. `handleUpload()` reads from that to parse the multipart body. This means the hook only runs in HTTP contexts — internal service calls with no `provider` receive no upload processing (and no errors).

---

## Quick start

```typescript
import { mantle } from "@mantlejs/core";
import { express } from "@mantlejs/express";
import { upload, diskStorage, handleUpload } from "@mantlejs/upload";

const app = mantle()
  .configure(express())
  .configure(
    upload({
      maxFileSize: 5 * 1024 * 1024,               // 5 MB
      allowedMimeTypes: ["image/jpeg", "image/png"],
      storage: diskStorage({ destination: "./uploads" }),
    }),
  );

app.use("photos", new PhotoService(new PhotoRepository(app)));

app.service("photos").hooks({
  before: {
    create: [handleUpload("photo", { required: true })],
  },
});

app.listen(3030);
```

**Upload a file**

```http
POST /photos
Content-Type: multipart/form-data; boundary=----boundary

------boundary
Content-Disposition: form-data; name="photo"; filename="avatar.jpg"
Content-Type: image/jpeg

<binary file data>
------boundary--
```

The service's `create` method receives `context.data.photo` as an `UploadedFile` object:

```json
{
  "fieldname": "photo",
  "originalname": "avatar.jpg",
  "mimetype": "image/jpeg",
  "size": 42317,
  "path": "./uploads/1718900000000-avatar.jpg"
}
```

---

## API

### `upload(config?)`

Returns a `MantlePlugin`. Call via `app.configure(upload(config))`.

```typescript
app.configure(
  upload({
    maxFileSize: 10 * 1024 * 1024,   // optional — default 10 MB
    allowedMimeTypes: ["image/jpeg"], // optional — default [] (all types allowed)
    storage: diskStorage({ destination: "./uploads" }), // optional — default local disk at ./uploads
  }),
);
```

Side effects:
- Stores the `UploadEngine` at `app.get("upload")`

#### `UploadConfig`

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `maxFileSize` | `number` | `10485760` (10 MB) | Maximum file size in bytes. Files that exceed this limit cause `handleUpload()` to throw `BadRequest`. |
| `allowedMimeTypes` | `string[]` | `[]` | Allowed MIME types. An empty array means all types are accepted. |
| `storage` | `StorageAdapter` | `diskStorage({ destination: "./uploads" })` | Where files are written. |

---

### `diskStorage(config)`

Built-in storage adapter that writes uploaded files to a local directory.

```typescript
import { diskStorage } from "@mantlejs/upload";

const storage = diskStorage({
  destination: "./uploads",

  // Optional: custom filename. Receives the file info; returns the filename string.
  // Default: `${Date.now()}-${originalname}`
  filename: (info) => `${info.fieldname}-${Date.now()}.${info.originalname.split(".").pop()}`,
});
```

- Creates `destination` (including parent directories) if it does not exist.
- Returns the absolute path of the saved file in `UploadedFile.path`.

#### `DiskStorageConfig`

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `destination` | `string` | — | Directory to write files into (required) |
| `filename` | `(info: UploadFileInfo) => string` | `${Date.now()}-${originalname}` | Filename transform |

---

### `handleUpload(field, options?)`

A `before` hook factory. Parses the multipart body, validates the file, stores it via the configured adapter, and writes an `UploadedFile` to `context.data[field]`.

```typescript
app.service("photos").hooks({
  before: {
    create: [handleUpload("photo", { required: true })],
    patch:  [handleUpload("photo")],               // optional — silently skips if absent
  },
});
```

#### Behaviour

| Condition | Result |
| --- | --- |
| `params.request` is absent (internal call) | Returns context unchanged |
| File field not present in form and `required: false` | Returns context unchanged |
| File field not present in form and `required: true` | Throws `BadRequest` |
| MIME type not in `allowedMimeTypes` | Throws `BadRequest` |
| File exceeds `maxFileSize` | Throws `BadRequest` |
| File valid | Writes `UploadedFile` to `context.data[field]` |

Unrelated form fields are discarded automatically. When multiple files share the same field name, only the first is captured.

#### `HandleUploadOptions`

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `required` | `boolean` | `false` | Whether the upload field must be present |

---

### `UploadedFile`

The shape of an uploaded file after `handleUpload()` processes it.

```typescript
interface UploadedFile {
  fieldname: string;    // the form field name (e.g. "photo")
  originalname: string; // original filename from the client
  mimetype: string;     // MIME type (e.g. "image/jpeg")
  size: number;         // file size in bytes
  path: string;         // resolved path on disk (local) or URL (cloud adapter)
}
```

---

## Writing a custom storage adapter

Implement `StorageAdapter` to redirect uploads to cloud storage, a database, or any other destination:

```typescript
import type { StorageAdapter, UploadFileInfo, UploadedFile } from "@mantlejs/upload";
import type { Readable } from "node:stream";

const s3Storage: StorageAdapter = {
  async store(stream: Readable, info: UploadFileInfo): Promise<UploadedFile> {
    const key = `uploads/${Date.now()}-${info.originalname}`;
    // stream to S3 ...
    return {
      fieldname: info.fieldname,
      originalname: info.originalname,
      mimetype: info.mimetype,
      size: bytesUploaded,
      path: `https://my-bucket.s3.amazonaws.com/${key}`,
    };
  },
};

app.configure(upload({ storage: s3Storage }));
```

---

## Types

```typescript
import type {
  UploadConfig,
  UploadedFile,
  UploadFileInfo,
  StorageAdapter,
  DiskStorageConfig,
  HandleUploadOptions,
} from "@mantlejs/upload";
```

| Type | Description |
| --- | --- |
| `UploadConfig` | Options passed to `upload()` |
| `UploadedFile` | Metadata returned after a file is stored |
| `UploadFileInfo` | Subset of file info available before storage (fieldname, originalname, mimetype) |
| `StorageAdapter` | Interface for custom storage backends |
| `DiskStorageConfig` | Options for `diskStorage()` |
| `HandleUploadOptions` | Options for `handleUpload()` |

---

## Error reference

| Error | Code | When thrown |
| --- | --- | --- |
| `BadRequest` | 400 | File field required but absent |
| `BadRequest` | 400 | MIME type not in `allowedMimeTypes` |
| `BadRequest` | 400 | File exceeds `maxFileSize` |

---

## Development

```bash
npx nx build upload   # compile
npx nx test upload    # run tests
npx nx lint upload    # lint
```

---

## Publishing

Build before publishing:

```bash
npx nx build upload
```

First publish (scoped packages require `--access public`):

```bash
cd packages/upload
npm publish --access public
```

Subsequent releases — bump `version` in `packages/upload/package.json`, then:

```bash
cd packages/upload
npm publish
```

### Testing locally with Verdaccio

```bash
# Terminal 1 — start the local registry
npx nx run @mantle/source:local-registry

# Terminal 2 — publish to it
cd packages/upload
npm publish --registry http://localhost:4873

# Install from it in another project
npm install @mantlejs/upload --registry http://localhost:4873
```
