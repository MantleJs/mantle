# @mantlejs/storage

File upload plugin for [Mantle JS](https://github.com/mantlejs/mantle). Parses `multipart/form-data` requests via [busboy](https://github.com/mscdex/busboy), writes files to local disk (or a custom adapter), validates MIME types and file sizes, and attaches uploaded file metadata to `context.data` through a `before` hook.

---

## Installation

```bash
npm install @mantlejs/storage busboy
```

---

## Concepts

### Plugin + hook model

`upload()` is a Mantle plugin that stores upload configuration on the app. It does **not** parse uploads by itself — parsing happens in the `handleUpload()` **before hook**, which you attach to whichever service methods accept files.

### Storage adapters

The built-in `diskStorage()` adapter writes files to a local directory. The `StorageAdapter` interface covers the full file lifecycle — `store()`, `retrieve()`, `delete()`, and an optional `getSignedUrl()` — so cloud adapters can be plugged in via the `storage` option. See [`@mantlejs/storage-s3`](../storage-s3) and [`@mantlejs/storage-gcs`](../storage-gcs) for cloud-backed implementations.

### How files reach the hook

The `@mantlejs/express` transport puts the raw `IncomingMessage` at `params.request`. `handleUpload()` reads from that to parse the multipart body. This means the hook only runs in HTTP contexts — internal service calls with no `provider` receive no upload processing (and no errors).

---

## Quick start

```typescript
import { mantle } from "@mantlejs/mantle";
import { express } from "@mantlejs/express";
import { upload, diskStorage, handleUpload } from "@mantlejs/storage";

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
  "path": "./uploads/1718900000000-avatar.jpg",
  "key": "1718900000000-avatar.jpg"
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
import { diskStorage } from "@mantlejs/storage";

const storage = diskStorage({
  destination: "./uploads",

  // Optional: custom filename. Receives the file info; returns the filename string.
  // Default: `${Date.now()}-${originalname}`
  filename: (info) => `${info.fieldname}-${Date.now()}.${info.originalname.split(".").pop()}`,
});
```

- Creates `destination` (including parent directories) if it does not exist.
- Returns the absolute path of the saved file in `UploadedFile.path`, and the filename (relative to `destination`) in `UploadedFile.key`.
- `retrieve(key)` and `delete(key)` take that same `key` value and resolve it against `destination`; both reject with `BadRequest` if the resolved path would escape `destination` (e.g. a `key` containing `../`), and `delete()` rejects with `NotFound` if the file does not exist.
- `getSignedUrl` is intentionally omitted — there is no direct-download concept for local disk.

#### `DiskStorageConfig`

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `destination` | `string` | — | Directory to write files into (required) |
| `filename` | `(info: UploadFileInfo) => string` | `${Date.now()}-${originalname}` | Filename transform |

---

### Retrieving and deleting stored files

Every `StorageAdapter` supports reading back and removing a previously stored file via the `key` returned from `store()`:

```typescript
const engine = app.get<UploadEngine>("upload");

const stream = await engine.storage.retrieve(uploadedFile.key); // Readable
await engine.storage.delete(uploadedFile.key);

if (engine.storage.getSignedUrl) {
  const url = await engine.storage.getSignedUrl(uploadedFile.key, { expiresIn: 300 });
}
```

`getSignedUrl` is optional on the interface — disk storage does not implement it, so always feature-detect before calling it.

#### `GetSignedUrlOptions`

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `expiresIn` | `number` | adapter-specific (S3/GCS default to 900s) | URL validity window, in seconds |

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
  path: string;         // resolved path on disk (local) or display URL (cloud adapter)
  key: string;          // the adapter-native key — pass this back to retrieve()/delete()/getSignedUrl()
}
```

---

## Writing a custom storage adapter

Implement `StorageAdapter` to redirect uploads to cloud storage, a database, or any other destination:

```typescript
import type { GetSignedUrlOptions, StorageAdapter, UploadFileInfo, UploadedFile } from "@mantlejs/storage";
import type { Readable } from "node:stream";

const customStorage: StorageAdapter = {
  async store(stream: Readable, info: UploadFileInfo): Promise<UploadedFile> {
    const key = `uploads/${Date.now()}-${info.originalname}`;
    // stream to the backend ...
    return {
      fieldname: info.fieldname,
      originalname: info.originalname,
      mimetype: info.mimetype,
      size: bytesUploaded,
      path: `https://my-bucket.example.com/${key}`,
      key,
    };
  },

  async retrieve(key: string): Promise<Readable> {
    // return a Readable for the stored object
  },

  async delete(key: string): Promise<void> {
    // remove the stored object
  },

  // optional — omit entirely if the backend has no direct-download concept
  async getSignedUrl(key: string, options?: GetSignedUrlOptions): Promise<string> {
    // return a time-limited download URL
  },
};

app.configure(upload({ storage: customStorage }));
```

`@mantlejs/storage-s3` and `@mantlejs/storage-gcs` are reference implementations of this interface backed by AWS S3 and Google Cloud Storage respectively.

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
  GetSignedUrlOptions,
} from "@mantlejs/storage";
```

| Type | Description |
| --- | --- |
| `UploadConfig` | Options passed to `upload()` |
| `UploadedFile` | Metadata returned after a file is stored |
| `UploadFileInfo` | Subset of file info available before storage (fieldname, originalname, mimetype) |
| `StorageAdapter` | Interface for custom storage backends (`store`, `retrieve`, `delete`, optional `getSignedUrl`) |
| `DiskStorageConfig` | Options for `diskStorage()` |
| `HandleUploadOptions` | Options for `handleUpload()` |
| `GetSignedUrlOptions` | Options for `StorageAdapter.getSignedUrl()` |

---

## Error reference

| Error | Code | When thrown |
| --- | --- | --- |
| `BadRequest` | 400 | File field required but absent |
| `BadRequest` | 400 | MIME type not in `allowedMimeTypes` |
| `BadRequest` | 400 | File exceeds `maxFileSize` |
| `BadRequest` | 400 | `diskStorage()` `retrieve`/`delete` called with a key that resolves outside `destination` |
| `NotFound` | 404 | `diskStorage()` `delete()` called with a key that does not exist |

---

## Development

```bash
npx nx build storage   # compile
npx nx test storage    # run tests
npx nx lint storage    # lint
```

---

## Publishing

Build before publishing:

```bash
npx nx build storage
```

First publish (scoped packages require `--access public`):

```bash
cd packages/storage
npm publish --access public
```

Subsequent releases — bump `version` in `packages/storage/package.json`, then:

```bash
cd packages/storage
npm publish
```

### Testing locally with Verdaccio

```bash
# Terminal 1 — start the local registry
npx nx run @mantle/source:local-registry

# Terminal 2 — publish to it
cd packages/storage
npm publish --registry http://localhost:4873

# Install from it in another project
npm install @mantlejs/storage --registry http://localhost:4873
```
