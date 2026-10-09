---
title: File storage
description: Multipart uploads through a before hook, stored on local disk, Amazon S3 (or any S3-compatible store), or Google Cloud Storage.
sidebar:
  order: 4
---

File uploads follow the same shape as everything else in Mantle: a plugin holds the configuration, and a hook
does the work on exactly the service methods that accept files.

| Package                                           | Storage                                                               |
| ------------------------------------------------- | --------------------------------------------------------------------- |
| [`@mantlejs/storage`](/packages/storage/)         | The `upload()` plugin, the `handleUpload()` hook, and `diskStorage()` |
| [`@mantlejs/storage-s3`](/packages/storage-s3/)   | `s3Storage()` — Amazon S3, MinIO, Cloudflare R2, other S3-compatibles |
| [`@mantlejs/storage-gcs`](/packages/storage-gcs/) | `gcsStorage()` — Google Cloud Storage                                 |

## Accepting uploads

```typescript
import { mantle } from "@mantlejs/mantle";
import { express } from "@mantlejs/express";
import { upload, diskStorage, handleUpload } from "@mantlejs/storage";

const app = mantle()
  .configure(express())
  .configure(
    upload({
      maxFileSize: 5 * 1024 * 1024,
      allowedMimeTypes: ["image/jpeg", "image/png"],
      storage: diskStorage({ destination: "./uploads" }),
    }),
  );

app.use("photos", new PhotoService(new PhotoRepository(app)));

app.service("photos").hooks({
  before: { create: [handleUpload("photo", { required: true })] },
});
```

A `multipart/form-data` `POST /photos` with a `photo` part is parsed (with busboy) and stored before the service
runs; `create` receives an `UploadedFile` descriptor in `context.data.photo` instead of the bytes — original name,
MIME type, size, and the adapter's `key` — plus any ordinary form fields. A file over `maxFileSize` or of a disallowed
type fails the call with a `BadRequest`.

`handleUpload()` reads the raw request the Express and Koa transports attach to `params.request`, so uploads need
[`@mantlejs/express`](/packages/express/) or [`@mantlejs/koa`](/packages/koa/); the zero-dependency
`@mantlejs/http` transport doesn't support them yet.

## Cloud storage

Swap the adapter; the hook doesn't change:

```typescript
import { s3Storage } from "@mantlejs/storage-s3";

app.configure(
  upload({
    storage: s3Storage({ bucket: process.env.S3_BUCKET!, region: process.env.AWS_REGION!, keyPrefix: "uploads/" }),
    maxFileSize: 10 * 1024 * 1024,
  }),
);
```

Every adapter implements `store()`, `retrieve()`, and `delete()`; cloud adapters also implement `getSignedUrl()` for
time-limited direct downloads. Feature-detect it — local disk has no such concept:

```typescript
import type { UploadEngine } from "@mantlejs/storage";

const engine = app.get<UploadEngine>("upload");
if (engine.storage.getSignedUrl) {
  const url = await engine.storage.getSignedUrl(file.key, { expiresIn: 300 });
}
```

## From the browser

[`@mantlejs/client`](/packages/client/#file-uploads) sends uploads with `service.upload()` — a multipart
`POST /:service` (or `PATCH /:service/:id` with `id`) carrying the same bearer auth, refresh-and-retry, and typed
errors as every other call, with optional progress events:

```typescript
const attachment = await api.service<Attachment>("attachments").upload(file, {
  fields: { articleId: "42" }, // merged into context.data by handleUpload()
  onProgress: ({ percent }) => setProgress(percent ?? 0),
});
```

The [`upload-dropzone`](/blocks/upload-dropzone/) UI block wraps it — drag-and-drop or a file picker, client-side
type and size checks, per-file progress, and the server's typed errors.
