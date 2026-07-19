import { Readable } from "node:stream";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NotFound } from "@mantlejs/mantle";
import { s3Storage, S3StorageAdapter } from "./s3-storage.js";

// ---------------------------------------------------------------------------
// Mock @aws-sdk/lib-storage and @aws-sdk/client-s3
// ---------------------------------------------------------------------------

function drainReadable(r: Readable): Promise<void> {
  return new Promise((resolve, reject) => {
    r.resume();
    r.on("end", resolve);
    r.on("error", reject);
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const MockUpload = vi.fn(function (this: any, input: { params: { Body: Readable } }) {
  this.done = async () => {
    await drainReadable(input.params.Body);
    return {};
  };
});

vi.mock("@aws-sdk/lib-storage", () => ({
  Upload: MockUpload,
}));

const mockSend = vi.fn();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const MockS3Client = vi.fn(function (this: any) {
  this.send = mockSend;
});

class MockGetObjectCommand {
  input: Record<string, unknown>;
  constructor(input: Record<string, unknown>) {
    this.input = input;
  }
}

class MockDeleteObjectCommand {
  input: Record<string, unknown>;
  constructor(input: Record<string, unknown>) {
    this.input = input;
  }
}

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: MockS3Client,
  GetObjectCommand: MockGetObjectCommand,
  DeleteObjectCommand: MockDeleteObjectCommand,
}));

const mockGetSignedUrl = vi.fn();

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: mockGetSignedUrl,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStream(content: string): Readable {
  return Readable.from([Buffer.from(content)]);
}

const defaultConfig = {
  bucket: "test-bucket",
  region: "us-east-1",
};

const fileInfo = {
  fieldname: "file",
  originalname: "avatar.png",
  mimetype: "image/png",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("s3Storage", () => {
  it("returns an S3StorageAdapter instance", () => {
    expect(s3Storage(defaultConfig)).toBeInstanceOf(S3StorageAdapter);
  });
});

describe("S3StorageAdapter#store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uploads the stream via @aws-sdk/lib-storage Upload and returns UploadedFile", async () => {
    const adapter = new S3StorageAdapter(defaultConfig);
    const result = await adapter.store(makeStream("image-data"), fileInfo);

    expect(MockUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          Bucket: "test-bucket",
          ContentType: "image/png",
        }),
      }),
    );
    expect(MockUpload).toHaveBeenCalledOnce();

    expect(result).toMatchObject({
      fieldname: "file",
      originalname: "avatar.png",
      mimetype: "image/png",
    });
    expect(result.path).toMatch(/^https:\/\/test-bucket\.s3\.us-east-1\.amazonaws\.com\//);
    expect(result.size).toBeGreaterThan(0);
    expect(result.key).toBe(result.path.replace(/^https:\/\/test-bucket\.s3\.us-east-1\.amazonaws\.com\//, ""));
  });

  it("applies keyPrefix to the default key", async () => {
    const adapter = new S3StorageAdapter({ ...defaultConfig, keyPrefix: "uploads/" });
    const result = await adapter.store(makeStream("data"), fileInfo);

    const uploadCall = MockUpload.mock.calls[0][0] as { params: { Key: string } };
    expect(uploadCall.params.Key).toMatch(/^uploads\//);
    expect(result.path).toContain("/uploads/");
  });

  it("uses custom key function when provided", async () => {
    const adapter = new S3StorageAdapter({
      ...defaultConfig,
      key: (info) => `custom/${info.originalname}`,
    });
    const result = await adapter.store(makeStream("data"), fileInfo);

    const uploadCall = MockUpload.mock.calls[0][0] as { params: { Key: string } };
    expect(uploadCall.params.Key).toBe("custom/avatar.png");
    expect(result.path).toBe("https://test-bucket.s3.us-east-1.amazonaws.com/custom/avatar.png");
  });

  it("passes ACL when provided", async () => {
    const adapter = new S3StorageAdapter({ ...defaultConfig, acl: "public-read" });
    await adapter.store(makeStream("data"), fileInfo);

    const uploadCall = MockUpload.mock.calls[0][0] as { params: { ACL?: string } };
    expect(uploadCall.params.ACL).toBe("public-read");
  });

  it("omits ACL when not provided", async () => {
    const adapter = new S3StorageAdapter(defaultConfig);
    await adapter.store(makeStream("data"), fileInfo);

    const uploadCall = MockUpload.mock.calls[0][0] as { params: { ACL?: string } };
    expect(uploadCall.params.ACL).toBeUndefined();
  });

  it("passes explicit credentials to S3Client", async () => {
    const credentials = { accessKeyId: "AKID", secretAccessKey: "SECRET" };
    const adapter = new S3StorageAdapter({ ...defaultConfig, credentials });
    await adapter.store(makeStream("data"), fileInfo);

    expect(MockS3Client).toHaveBeenCalledWith(expect.objectContaining({ credentials }));
  });

  it("counts bytes and sets size on the returned UploadedFile", async () => {
    const content = "hello world";
    const adapter = new S3StorageAdapter(defaultConfig);
    const result = await adapter.store(makeStream(content), fileInfo);

    expect(result.size).toBe(Buffer.byteLength(content));
  });
});

describe("S3StorageAdapter#retrieve", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches the object via GetObjectCommand and returns its Body", async () => {
    const body = makeStream("object-data");
    mockSend.mockResolvedValue({ Body: body });

    const adapter = new S3StorageAdapter(defaultConfig);
    const result = await adapter.retrieve("uploads/file.png");

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ input: { Bucket: "test-bucket", Key: "uploads/file.png" } }),
    );
    expect(result).toBe(body);
  });

  it("throws NotFound when the object does not exist", async () => {
    const notFound = new Error("not found");
    notFound.name = "NoSuchKey";
    mockSend.mockRejectedValue(notFound);

    const adapter = new S3StorageAdapter(defaultConfig);
    await expect(adapter.retrieve("missing.png")).rejects.toBeInstanceOf(NotFound);
  });

  it("rethrows other errors unchanged", async () => {
    const boom = new Error("network down");
    mockSend.mockRejectedValue(boom);

    const adapter = new S3StorageAdapter(defaultConfig);
    await expect(adapter.retrieve("file.png")).rejects.toThrow("network down");
  });
});

describe("S3StorageAdapter#delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes the object via DeleteObjectCommand", async () => {
    mockSend.mockResolvedValue({});

    const adapter = new S3StorageAdapter(defaultConfig);
    await adapter.delete("uploads/file.png");

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ input: { Bucket: "test-bucket", Key: "uploads/file.png" } }),
    );
  });
});

describe("S3StorageAdapter#getSignedUrl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a presigned URL with the default expiry", async () => {
    mockGetSignedUrl.mockResolvedValue("https://signed.example/file.png");

    const adapter = new S3StorageAdapter(defaultConfig);
    const url = await adapter.getSignedUrl("uploads/file.png");

    expect(url).toBe("https://signed.example/file.png");
    expect(mockGetSignedUrl).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ input: { Bucket: "test-bucket", Key: "uploads/file.png" } }),
      { expiresIn: 900 },
    );
  });

  it("passes a custom expiresIn through", async () => {
    mockGetSignedUrl.mockResolvedValue("https://signed.example/file.png");

    const adapter = new S3StorageAdapter(defaultConfig);
    await adapter.getSignedUrl("uploads/file.png", { expiresIn: 60 });

    expect(mockGetSignedUrl).toHaveBeenCalledWith(expect.anything(), expect.anything(), { expiresIn: 60 });
  });
});
