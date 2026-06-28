import { Readable } from "node:stream";
import { describe, it, expect, vi, beforeEach } from "vitest";
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-empty-function
const MockS3Client = vi.fn(function (this: any) {});

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: MockS3Client,
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
