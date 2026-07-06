import { Transform } from "node:stream";
import type { Readable } from "node:stream";
import type { StorageAdapter, UploadedFile, UploadFileInfo } from "@mantlejs/storage";

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

export class S3StorageAdapter implements StorageAdapter {
  private readonly config: S3StorageConfig;

  constructor(config: S3StorageConfig) {
    this.config = config;
  }

  async store(stream: Readable, info: UploadFileInfo): Promise<UploadedFile> {
    const { Upload } = await import("@aws-sdk/lib-storage");
    const { S3Client } = await import("@aws-sdk/client-s3");

    const { bucket, region, keyPrefix = "", acl, credentials } = this.config;

    const client = new S3Client({
      region,
      ...(credentials ? { credentials } : {}),
    });

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
    };
  }
}

export function s3Storage(config: S3StorageConfig): S3StorageAdapter {
  return new S3StorageAdapter(config);
}
