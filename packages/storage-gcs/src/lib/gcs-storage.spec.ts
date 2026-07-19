import { Readable, PassThrough } from "node:stream";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NotFound } from "@mantlejs/mantle";
import { gcsStorage, GcsStorageAdapter } from "./gcs-storage.js";

// ---------------------------------------------------------------------------
// Mock @google-cloud/storage
// ---------------------------------------------------------------------------

let mockWriteStream: PassThrough;
let createWriteStreamOptions: Record<string, unknown> | undefined;

const mockBucket = {
  file: vi.fn(),
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const MockStorage = vi.fn(function (this: any) {
  this.bucket = vi.fn().mockReturnValue(mockBucket);
});

vi.mock("@google-cloud/storage", () => ({
  Storage: MockStorage,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStream(content: string): Readable {
  return Readable.from([Buffer.from(content)]);
}

function makeMockFile() {
  return {
    createWriteStream: vi.fn().mockImplementation((options: Record<string, unknown>) => {
      createWriteStreamOptions = options;
      return mockWriteStream;
    }),
    createReadStream: vi.fn(),
    delete: vi.fn().mockResolvedValue(undefined),
    getSignedUrl: vi.fn().mockResolvedValue(["https://signed.example/file.png"]),
  };
}

const defaultConfig = {
  bucket: "test-bucket",
};

const fileInfo = {
  fieldname: "file",
  originalname: "photo.jpg",
  mimetype: "image/jpeg",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("gcsStorage", () => {
  it("returns a GcsStorageAdapter instance", () => {
    expect(gcsStorage(defaultConfig)).toBeInstanceOf(GcsStorageAdapter);
  });
});

describe("GcsStorageAdapter#store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createWriteStreamOptions = undefined;

    mockWriteStream = new PassThrough();

    const mockFile = makeMockFile();
    mockBucket.file.mockReturnValue(mockFile);

    MockStorage.mockImplementation(function (this: Record<string, unknown>) {
      this["bucket"] = vi.fn().mockReturnValue(mockBucket);
    });
  });

  it("stores the stream and returns a gs:// path when public is false (default)", async () => {
    const adapter = new GcsStorageAdapter(defaultConfig);
    mockWriteStream.resume();

    const result = await adapter.store(makeStream("image-data"), fileInfo);

    expect(result).toMatchObject({
      fieldname: "file",
      originalname: "photo.jpg",
      mimetype: "image/jpeg",
    });
    expect(result.path).toMatch(/^gs:\/\/test-bucket\//);
    expect(result.size).toBe(Buffer.byteLength("image-data"));
    expect(result.key).toBe(result.path.replace("gs://test-bucket/", ""));
  });

  it("returns an HTTPS URL when public is true", async () => {
    const adapter = new GcsStorageAdapter({ ...defaultConfig, public: true });
    mockWriteStream.resume();

    const result = await adapter.store(makeStream("data"), fileInfo);

    expect(result.path).toMatch(/^https:\/\/storage\.googleapis\.com\/test-bucket\//);
  });

  it("applies keyPrefix to the default key", async () => {
    const adapter = new GcsStorageAdapter({ ...defaultConfig, keyPrefix: "uploads/" });
    mockWriteStream.resume();

    await adapter.store(makeStream("data"), fileInfo);

    const keyArg = mockBucket.file.mock.calls[0][0] as string;
    expect(keyArg).toMatch(/^uploads\//);
  });

  it("uses custom key function when provided", async () => {
    const adapter = new GcsStorageAdapter({
      ...defaultConfig,
      public: true,
      key: (info) => `custom/${info.originalname}`,
    });
    mockWriteStream.resume();

    const result = await adapter.store(makeStream("data"), fileInfo);

    const keyArg = mockBucket.file.mock.calls[0][0] as string;
    expect(keyArg).toBe("custom/photo.jpg");
    expect(result.path).toBe("https://storage.googleapis.com/test-bucket/custom/photo.jpg");
  });

  it("sets predefinedAcl=publicRead when public is true", async () => {
    const adapter = new GcsStorageAdapter({ ...defaultConfig, public: true });
    mockWriteStream.resume();

    await adapter.store(makeStream("data"), fileInfo);

    expect(createWriteStreamOptions).toMatchObject({ predefinedAcl: "publicRead" });
  });

  it("omits predefinedAcl when public is false (default)", async () => {
    const adapter = new GcsStorageAdapter(defaultConfig);
    mockWriteStream.resume();

    await adapter.store(makeStream("data"), fileInfo);

    expect(createWriteStreamOptions?.["predefinedAcl"]).toBeUndefined();
  });

  it("passes keyFilename to Storage constructor when provided", async () => {
    const adapter = new GcsStorageAdapter({ ...defaultConfig, keyFilename: "/path/to/key.json" });
    mockWriteStream.resume();

    await adapter.store(makeStream("data"), fileInfo);

    expect(MockStorage).toHaveBeenCalledWith(expect.objectContaining({ keyFilename: "/path/to/key.json" }));
  });

  it("passes projectId to Storage constructor when provided", async () => {
    const adapter = new GcsStorageAdapter({ ...defaultConfig, projectId: "my-project" });
    mockWriteStream.resume();

    await adapter.store(makeStream("data"), fileInfo);

    expect(MockStorage).toHaveBeenCalledWith(expect.objectContaining({ projectId: "my-project" }));
  });

  it("sets content-type metadata on the write stream options", async () => {
    const adapter = new GcsStorageAdapter(defaultConfig);
    mockWriteStream.resume();

    await adapter.store(makeStream("data"), fileInfo);

    expect(createWriteStreamOptions).toMatchObject({ metadata: { contentType: "image/jpeg" } });
  });

  it("rejects when the write stream emits an error", async () => {
    const adapter = new GcsStorageAdapter(defaultConfig);
    const boom = new Error("GCS write failure");

    const hangingSource = new PassThrough();
    hangingSource.write(Buffer.from("partial"));

    process.nextTick(() => mockWriteStream.destroy(boom));

    await expect(adapter.store(hangingSource, fileInfo)).rejects.toThrow("GCS write failure");
  });
});

describe("GcsStorageAdapter#retrieve", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const mockFile = makeMockFile();
    mockBucket.file.mockReturnValue(mockFile);
  });

  it("returns the file's read stream", async () => {
    const readStream = new PassThrough();
    const mockFile = makeMockFile();
    mockFile.createReadStream.mockReturnValue(readStream);
    mockBucket.file.mockReturnValue(mockFile);

    const adapter = new GcsStorageAdapter(defaultConfig);
    const result = await adapter.retrieve("uploads/photo.jpg");

    expect(mockBucket.file).toHaveBeenCalledWith("uploads/photo.jpg");
    expect(result).toBe(readStream);
  });
});

describe("GcsStorageAdapter#delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const mockFile = makeMockFile();
    mockBucket.file.mockReturnValue(mockFile);
  });

  it("deletes the file by key", async () => {
    const mockFile = makeMockFile();
    mockBucket.file.mockReturnValue(mockFile);

    const adapter = new GcsStorageAdapter(defaultConfig);
    await adapter.delete("uploads/photo.jpg");

    expect(mockBucket.file).toHaveBeenCalledWith("uploads/photo.jpg");
    expect(mockFile.delete).toHaveBeenCalledOnce();
  });

  it("throws NotFound when the underlying object does not exist", async () => {
    const mockFile = makeMockFile();
    mockFile.delete.mockRejectedValue(Object.assign(new Error("not found"), { code: 404 }));
    mockBucket.file.mockReturnValue(mockFile);

    const adapter = new GcsStorageAdapter(defaultConfig);
    await expect(adapter.delete("missing.jpg")).rejects.toBeInstanceOf(NotFound);
  });

  it("rethrows other errors unchanged", async () => {
    const mockFile = makeMockFile();
    mockFile.delete.mockRejectedValue(new Error("network down"));
    mockBucket.file.mockReturnValue(mockFile);

    const adapter = new GcsStorageAdapter(defaultConfig);
    await expect(adapter.delete("photo.jpg")).rejects.toThrow("network down");
  });
});

describe("GcsStorageAdapter#getSignedUrl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a signed URL with the default expiry", async () => {
    const mockFile = makeMockFile();
    mockBucket.file.mockReturnValue(mockFile);
    vi.useFakeTimers().setSystemTime(0);

    const adapter = new GcsStorageAdapter(defaultConfig);
    const url = await adapter.getSignedUrl("uploads/photo.jpg");

    expect(url).toBe("https://signed.example/file.png");
    expect(mockFile.getSignedUrl).toHaveBeenCalledWith({ action: "read", expires: 900_000 });
    vi.useRealTimers();
  });

  it("passes a custom expiresIn through", async () => {
    const mockFile = makeMockFile();
    mockBucket.file.mockReturnValue(mockFile);
    vi.useFakeTimers().setSystemTime(0);

    const adapter = new GcsStorageAdapter(defaultConfig);
    await adapter.getSignedUrl("uploads/photo.jpg", { expiresIn: 60 });

    expect(mockFile.getSignedUrl).toHaveBeenCalledWith({ action: "read", expires: 60_000 });
    vi.useRealTimers();
  });
});
