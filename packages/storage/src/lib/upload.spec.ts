import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, readdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { PassThrough, Readable } from "node:stream";
import type { IncomingMessage } from "node:http";
import type { MantleApplication, HookContext } from "@mantlejs/mantle";
import { BadRequest } from "@mantlejs/mantle";
import { upload } from "./upload.js";
import { diskStorage } from "./disk-storage.js";
import { handleUpload } from "./handle-upload.js";
import type { UploadEngine, StorageAdapter, UploadedFile, UploadFileInfo } from "./types.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeApp(overrides: Record<string, unknown> = {}): MantleApplication {
  const store = new Map(Object.entries(overrides));
  const app: MantleApplication = {
    set: vi.fn((key: string, value: unknown) => {
      store.set(key, value);
      return app;
    }),
    get: vi.fn((key: string) => store.get(key)),
    use: vi.fn().mockReturnThis(),
    configure: vi.fn().mockReturnThis(),
    teardown: vi.fn().mockResolvedValue(undefined),
    service: vi.fn(),
  } as unknown as MantleApplication;
  return app;
}

const BOUNDARY = "test-boundary-abc123";

function buildMultipartBody(fieldname: string, filename: string, mimeType: string, content: string | Buffer): Buffer {
  const CRLF = "\r\n";
  const contentBuf = Buffer.isBuffer(content) ? content : Buffer.from(content);
  return Buffer.concat([
    Buffer.from(
      `--${BOUNDARY}${CRLF}` +
        `Content-Disposition: form-data; name="${fieldname}"; filename="${filename}"${CRLF}` +
        `Content-Type: ${mimeType}${CRLF}${CRLF}`,
    ),
    contentBuf,
    Buffer.from(`${CRLF}--${BOUNDARY}--${CRLF}`),
  ]);
}

function makeMultipartRequest(body: Buffer): IncomingMessage {
  const stream = new PassThrough();
  Object.assign(stream, {
    headers: {
      "content-type": `multipart/form-data; boundary=${BOUNDARY}`,
      "content-length": body.length.toString(),
    },
  });
  process.nextTick(() => stream.end(body));
  return stream as unknown as IncomingMessage;
}

function makeEngine(overrides: Partial<UploadEngine> = {}): UploadEngine {
  return {
    maxFileSize: 10 * 1024 * 1024,
    allowedMimeTypes: [],
    storage: {
      store: vi.fn().mockResolvedValue({
        fieldname: "file",
        originalname: "test.txt",
        mimetype: "text/plain",
        size: 13,
        path: "/tmp/test.txt",
      }),
    },
    ...overrides,
  };
}

function makeCtx(overrides: Partial<HookContext> = {}): HookContext {
  const app = makeApp();
  return {
    app,
    service: {},
    path: "files",
    method: "create",
    params: { provider: "rest" },
    data: {},
    ...overrides,
  } as HookContext;
}

// ─── upload() plugin ──────────────────────────────────────────────────────────

describe("upload()", () => {
  it("registers the upload engine on the app", () => {
    const app = makeApp();
    upload()(app);
    expect(app.set).toHaveBeenCalledWith("upload", expect.objectContaining({ maxFileSize: expect.any(Number) }));
  });

  it("defaults maxFileSize to 10MB", () => {
    const app = makeApp();
    upload()(app);
    const engine = (app as unknown as { get: (k: string) => UploadEngine }).get("upload");
    expect(engine.maxFileSize).toBe(10 * 1024 * 1024);
  });

  it("defaults allowedMimeTypes to empty array (all types allowed)", () => {
    const app = makeApp();
    upload()(app);
    const engine = (app as unknown as { get: (k: string) => UploadEngine }).get("upload");
    expect(engine.allowedMimeTypes).toEqual([]);
  });

  it("applies custom maxFileSize", () => {
    const app = makeApp();
    upload({ maxFileSize: 1024 })(app);
    const engine = (app as unknown as { get: (k: string) => UploadEngine }).get("upload");
    expect(engine.maxFileSize).toBe(1024);
  });

  it("applies custom allowedMimeTypes", () => {
    const app = makeApp();
    upload({ allowedMimeTypes: ["image/jpeg", "image/png"] })(app);
    const engine = (app as unknown as { get: (k: string) => UploadEngine }).get("upload");
    expect(engine.allowedMimeTypes).toEqual(["image/jpeg", "image/png"]);
  });

  it("uses a custom storage adapter when provided", () => {
    const adapter: StorageAdapter = {
      store: vi.fn(),
    };
    const app = makeApp();
    upload({ storage: adapter })(app);
    const engine = (app as unknown as { get: (k: string) => UploadEngine }).get("upload");
    expect(engine.storage).toBe(adapter);
  });
});

// ─── diskStorage() ───────────────────────────────────────────────────────────

describe("diskStorage()", () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "mantle-upload-test-"));
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("stores a file and returns correct metadata", async () => {
    const storage = diskStorage({ destination: tmpDir, filename: () => "stored.txt" });
    const stream = Readable.from(["Hello, World!"]);
    const info: UploadFileInfo = { fieldname: "file", originalname: "hello.txt", mimetype: "text/plain" };

    const result = await storage.store(stream, info);

    expect(result.fieldname).toBe("file");
    expect(result.originalname).toBe("hello.txt");
    expect(result.mimetype).toBe("text/plain");
    expect(result.size).toBe(13);
    expect(result.path).toBe(join(tmpDir, "stored.txt"));
  });

  it("writes file contents to disk", async () => {
    const storage = diskStorage({ destination: tmpDir, filename: () => "contents.txt" });
    const content = "file content check";
    const stream = Readable.from([content]);
    const info: UploadFileInfo = { fieldname: "file", originalname: "c.txt", mimetype: "text/plain" };

    const result = await storage.store(stream, info);

    const written = await readFile(result.path, "utf8");
    expect(written).toBe(content);
  });

  it("uses default filename pattern (timestamp-originalname) when no filename fn given", async () => {
    const storage = diskStorage({ destination: tmpDir });
    const stream = Readable.from(["data"]);
    const info: UploadFileInfo = { fieldname: "file", originalname: "original.txt", mimetype: "text/plain" };

    const result = await storage.store(stream, info);

    expect(result.path).toMatch(/\d+-original\.txt$/);
  });

  it("creates the destination directory if it does not exist", async () => {
    const nested = join(tmpDir, "nested", "deep");
    const storage = diskStorage({ destination: nested, filename: () => "f.txt" });
    const stream = Readable.from(["x"]);
    const info: UploadFileInfo = { fieldname: "f", originalname: "f.txt", mimetype: "text/plain" };

    await storage.store(stream, info);

    const files = await readdir(nested);
    expect(files).toContain("f.txt");
  });

  it("passes UploadFileInfo to the filename function", async () => {
    const filenameFn = vi.fn(() => "custom-name.txt");
    const storage = diskStorage({ destination: tmpDir, filename: filenameFn });
    const stream = Readable.from(["x"]);
    const info: UploadFileInfo = { fieldname: "avatar", originalname: "photo.jpg", mimetype: "image/jpeg" };

    await storage.store(stream, info);

    expect(filenameFn).toHaveBeenCalledWith(info);
  });

  it("never writes outside the destination for a traversal originalname", async () => {
    const storage = diskStorage({ destination: tmpDir });
    const stream = Readable.from(["evil"]);
    const info: UploadFileInfo = { fieldname: "file", originalname: "../../evil.sh", mimetype: "text/plain" };

    const result = await storage.store(stream, info);

    const resolvedDestination = await realpath(tmpDir);
    expect((await realpath(result.path)).startsWith(resolvedDestination + sep)).toBe(true);
    expect(result.path).toMatch(/\d+-evil\.sh$/);
  });

  it("strips null bytes from the default filename", async () => {
    const storage = diskStorage({ destination: tmpDir });
    const stream = Readable.from(["x"]);
    const info: UploadFileInfo = { fieldname: "file", originalname: "a\0b.txt", mimetype: "text/plain" };

    const result = await storage.store(stream, info);

    expect(result.path).not.toContain("\0");
    expect(result.path).toMatch(/\d+-ab\.txt$/);
  });

  it("throws BadRequest when a filename function returns a traversal path", async () => {
    const storage = diskStorage({ destination: tmpDir, filename: () => "../escape.txt" });
    const stream = Readable.from(["x"]);
    const info: UploadFileInfo = { fieldname: "file", originalname: "ok.txt", mimetype: "text/plain" };

    await expect(storage.store(stream, info)).rejects.toBeInstanceOf(BadRequest);
  });

  it("throws BadRequest when a filename function escapes the root with nested traversal", async () => {
    const storage = diskStorage({ destination: tmpDir, filename: () => "a/../../escape.txt" });
    const stream = Readable.from(["x"]);
    const info: UploadFileInfo = { fieldname: "file", originalname: "ok.txt", mimetype: "text/plain" };

    await expect(storage.store(stream, info)).rejects.toBeInstanceOf(BadRequest);
  });
});

// ─── handleUpload() hook ──────────────────────────────────────────────────────

describe("handleUpload()", () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "mantle-upload-hook-test-"));
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns context unchanged when params.request is absent and required is false", async () => {
    const engine = makeEngine();
    const ctx = makeCtx({ app: makeApp({ upload: engine }) });
    const result = await handleUpload("file")(ctx);
    expect(result).toBe(ctx);
  });

  it("throws BadRequest when params.request is absent and required is true", async () => {
    const engine = makeEngine();
    const ctx = makeCtx({ app: makeApp({ upload: engine }) });
    await expect(handleUpload("file", { required: true })(ctx)).rejects.toBeInstanceOf(BadRequest);
  });

  it("parses a multipart upload and attaches file metadata to context.data", async () => {
    const storage = diskStorage({ destination: tmpDir });
    const engine = makeEngine({ storage });
    const body = buildMultipartBody("file", "hello.txt", "text/plain", "Hello, World!");
    const req = makeMultipartRequest(body);
    const ctx = makeCtx({ app: makeApp({ upload: engine }), params: { provider: "rest", request: req } });

    const result = await handleUpload("file")(ctx);

    const uploaded = (result.data as Record<string, UploadedFile>)["file"];
    expect(uploaded.fieldname).toBe("file");
    expect(uploaded.originalname).toBe("hello.txt");
    expect(uploaded.mimetype).toBe("text/plain");
    expect(uploaded.size).toBe(13);
    expect(uploaded.path).toContain(tmpDir);
  });

  it("merges file into existing context.data fields", async () => {
    const storage = diskStorage({ destination: tmpDir });
    const engine = makeEngine({ storage });
    const body = buildMultipartBody("avatar", "photo.jpg", "image/jpeg", "fake-image-bytes");
    const req = makeMultipartRequest(body);
    const existingData = { name: "Alice", age: 30 };
    const ctx = makeCtx({
      app: makeApp({ upload: engine }),
      params: { provider: "rest", request: req },
      data: existingData,
    });

    const result = await handleUpload("avatar")(ctx);

    const data = result.data as Record<string, unknown>;
    expect(data["name"]).toBe("Alice");
    expect(data["age"]).toBe(30);
    expect(data["avatar"]).toBeDefined();
  });

  it("returns context unchanged when the field is not present in the form and required is false", async () => {
    const engine = makeEngine();
    const body = buildMultipartBody("other-field", "x.txt", "text/plain", "x");
    const req = makeMultipartRequest(body);
    const ctx = makeCtx({ app: makeApp({ upload: engine }), params: { provider: "rest", request: req } });

    const result = await handleUpload("file")(ctx);

    expect((result.data as Record<string, unknown>)["file"]).toBeUndefined();
  });

  it("throws BadRequest when the field is not present in the form and required is true", async () => {
    const engine = makeEngine();
    const body = buildMultipartBody("other-field", "x.txt", "text/plain", "x");
    const req = makeMultipartRequest(body);
    const ctx = makeCtx({ app: makeApp({ upload: engine }), params: { provider: "rest", request: req } });

    await expect(handleUpload("file", { required: true })(ctx)).rejects.toBeInstanceOf(BadRequest);
  });

  it("throws BadRequest when the MIME type is not in allowedMimeTypes", async () => {
    const storage = diskStorage({ destination: tmpDir });
    const engine = makeEngine({ storage, allowedMimeTypes: ["image/jpeg", "image/png"] });
    const body = buildMultipartBody("file", "doc.pdf", "application/pdf", "pdf-bytes");
    const req = makeMultipartRequest(body);
    const ctx = makeCtx({ app: makeApp({ upload: engine }), params: { provider: "rest", request: req } });

    await expect(handleUpload("file")(ctx)).rejects.toBeInstanceOf(BadRequest);
  });

  it("accepts files whose MIME type is in allowedMimeTypes", async () => {
    const storage = diskStorage({ destination: tmpDir });
    const engine = makeEngine({ storage, allowedMimeTypes: ["image/jpeg"] });
    const body = buildMultipartBody("photo", "img.jpg", "image/jpeg", "jpeg-bytes");
    const req = makeMultipartRequest(body);
    const ctx = makeCtx({ app: makeApp({ upload: engine }), params: { provider: "rest", request: req } });

    const result = await handleUpload("photo")(ctx);

    const uploaded = (result.data as Record<string, UploadedFile>)["photo"];
    expect(uploaded.mimetype).toBe("image/jpeg");
  });

  it("discards unrelated form fields and captures only the target field", async () => {
    const storage = diskStorage({ destination: tmpDir });
    const engine = makeEngine({ storage });
    const CRLF = "\r\n";
    const body = Buffer.concat([
      Buffer.from(`--${BOUNDARY}${CRLF}Content-Disposition: form-data; name="unrelated"; filename="a.txt"${CRLF}Content-Type: text/plain${CRLF}${CRLF}aaa${CRLF}`),
      Buffer.from(`--${BOUNDARY}${CRLF}Content-Disposition: form-data; name="file"; filename="b.txt"${CRLF}Content-Type: text/plain${CRLF}${CRLF}bbb${CRLF}`),
      Buffer.from(`--${BOUNDARY}--${CRLF}`),
    ]);
    const req = makeMultipartRequest(body);
    const ctx = makeCtx({ app: makeApp({ upload: engine }), params: { provider: "rest", request: req } });

    const result = await handleUpload("file")(ctx);

    const uploaded = (result.data as Record<string, UploadedFile>)["file"];
    expect(uploaded.originalname).toBe("b.txt");
  });

  it("throws BadRequest when the file exceeds maxFileSize", async () => {
    const storage = diskStorage({ destination: tmpDir });
    const engine = makeEngine({ storage, maxFileSize: 5 });
    const body = buildMultipartBody("file", "big.txt", "text/plain", "more than five bytes");
    const req = makeMultipartRequest(body);
    const ctx = makeCtx({ app: makeApp({ upload: engine }), params: { provider: "rest", request: req } });

    await expect(handleUpload("file")(ctx)).rejects.toBeInstanceOf(BadRequest);
  });
});
