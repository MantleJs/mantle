import { Transform } from "node:stream";
import type { Readable } from "node:stream";
import { NotFound } from "@mantlejs/mantle";
import type { GetSignedUrlOptions, StorageAdapter, UploadedFile, UploadFileInfo } from "@mantlejs/storage";

export interface S3StorageConfig {
  bucket: string;
  region: string;
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
  };
  keyPrefix?: string;
  acl?: "private" | "public-read";
  key?: (file: UploadFileInfo) => string;
}

const DEFAULT_SIGNED_URL_EXPIRES_IN = 900;

export class S3StorageAdapter implements StorageAdapter {
  private readonly config: S3StorageConfig;

  constructor(config: S3StorageConfig) {
    this.config = config;
  }

  private async createClient() {
    const { S3Client } = await import("@aws-sdk/client-s3");
    const { region, credentials } = this.config;

    return new S3Client({
      region,
      ...(credentials ? { credentials } : {}),
    });
  }

  async store(stream: Readable, info: UploadFileInfo): Promise<UploadedFile> {
    const { Upload } = await import("@aws-sdk/lib-storage");

    const { bucket, region, keyPrefix = "", acl } = this.config;
    const client = await this.createClient();

    const resolvedKey = this.config.key ? this.config.key(info) : `${keyPrefix}${Date.now()}-${info.originalname}`;

    let size = 0;
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length;
        callback(null, chunk);
      },
    });

    const upload = new Upload({
      client,
      params: {
        Bucket: bucket,
        Key: resolvedKey,
        Body: stream.pipe(counter),
        ContentType: info.mimetype,
        ...(acl ? { ACL: acl } : {}),
      },
    });

    await upload.done();

    return {
      fieldname: info.fieldname,
      originalname: info.originalname,
      mimetype: info.mimetype,
      size,
      path: `https://${bucket}.s3.${region}.amazonaws.com/${resolvedKey}`,
      key: resolvedKey,
    };
  }

  async retrieve(key: string): Promise<Readable> {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await this.createClient();

    try {
      const response = await client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: key }));
      return response.Body as Readable;
    } catch (err) {
      if (err instanceof Error && err.name === "NoSuchKey") {
        throw new NotFound(`Storage key '${key}' not found`);
      }
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await this.createClient();

    await client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }));
  }

  async getSignedUrl(key: string, options: GetSignedUrlOptions = {}): Promise<string> {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
    const client = await this.createClient();

    return getSignedUrl(client, new GetObjectCommand({ Bucket: this.config.bucket, Key: key }), {
      expiresIn: options.expiresIn ?? DEFAULT_SIGNED_URL_EXPIRES_IN,
    });
  }
}

export function s3Storage(config: S3StorageConfig): S3StorageAdapter {
  return new S3StorageAdapter(config);
}
