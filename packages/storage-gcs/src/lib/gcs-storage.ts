import { Transform } from "node:stream";
import type { Readable } from "node:stream";
import type { StorageAdapter, UploadedFile, UploadFileInfo } from "@mantlejs/storage";

export interface GcsStorageConfig {
  bucket: string;
  projectId?: string;
  keyFilename?: string;
  keyPrefix?: string;
  public?: boolean;
  key?: (file: UploadFileInfo) => string;
}

export class GcsStorageAdapter implements StorageAdapter {
  private readonly config: GcsStorageConfig;

  constructor(config: GcsStorageConfig) {
    this.config = config;
  }

  async store(stream: Readable, info: UploadFileInfo): Promise<UploadedFile> {
    const { Storage } = await import("@google-cloud/storage");

    const { bucket: bucketName, keyPrefix = "", public: isPublic = false, projectId, keyFilename } = this.config;

    const storageOptions: Record<string, unknown> = {};
    if (projectId) storageOptions["projectId"] = projectId;
    if (keyFilename) storageOptions["keyFilename"] = keyFilename;

    const storage = new Storage(storageOptions);
    const bucket = storage.bucket(bucketName);

    const resolvedKey = this.config.key ? this.config.key(info) : `${keyPrefix}${Date.now()}-${info.originalname}`;

    const file = bucket.file(resolvedKey);

    let size = 0;
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length;
        callback(null, chunk);
      },
    });

    const writeStream = file.createWriteStream({
      metadata: { contentType: info.mimetype },
      ...(isPublic ? { predefinedAcl: "publicRead" } : {}),
    });

    await new Promise<void>((resolve, reject) => {
      stream.pipe(counter).pipe(writeStream).on("finish", resolve).on("error", reject);
    });

    const path = isPublic
      ? `https://storage.googleapis.com/${bucketName}/${resolvedKey}`
      : `gs://${bucketName}/${resolvedKey}`;

    return {
      fieldname: info.fieldname,
      originalname: info.originalname,
      mimetype: info.mimetype,
      size,
      path,
    };
  }
}

export function gcsStorage(config: GcsStorageConfig): GcsStorageAdapter {
  return new GcsStorageAdapter(config);
}
