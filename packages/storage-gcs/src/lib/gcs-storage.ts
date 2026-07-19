import { Transform } from "node:stream";
import type { Readable } from "node:stream";
import { NotFound } from "@mantlejs/mantle";
import type { GetSignedUrlOptions, StorageAdapter, UploadedFile, UploadFileInfo } from "@mantlejs/storage";

export interface GcsStorageConfig {
  bucket: string;
  projectId?: string;
  keyFilename?: string;
  keyPrefix?: string;
  public?: boolean;
  key?: (file: UploadFileInfo) => string;
}

const DEFAULT_SIGNED_URL_EXPIRES_IN = 900;

export class GcsStorageAdapter implements StorageAdapter {
  private readonly config: GcsStorageConfig;

  constructor(config: GcsStorageConfig) {
    this.config = config;
  }

  private async getBucket() {
    const { Storage } = await import("@google-cloud/storage");
    const { bucket: bucketName, projectId, keyFilename } = this.config;

    const storageOptions: Record<string, unknown> = {};
    if (projectId) storageOptions["projectId"] = projectId;
    if (keyFilename) storageOptions["keyFilename"] = keyFilename;

    return new Storage(storageOptions).bucket(bucketName);
  }

  async store(stream: Readable, info: UploadFileInfo): Promise<UploadedFile> {
    const bucket = await this.getBucket();
    const { bucket: bucketName, keyPrefix = "", public: isPublic = false } = this.config;

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
      key: resolvedKey,
    };
  }

  async retrieve(key: string): Promise<Readable> {
    const bucket = await this.getBucket();
    return bucket.file(key).createReadStream();
  }

  async delete(key: string): Promise<void> {
    const bucket = await this.getBucket();

    try {
      await bucket.file(key).delete();
    } catch (err) {
      if ((err as { code?: number }).code === 404) {
        throw new NotFound(`Storage key '${key}' not found`);
      }
      throw err;
    }
  }

  async getSignedUrl(key: string, options: GetSignedUrlOptions = {}): Promise<string> {
    const bucket = await this.getBucket();

    const [url] = await bucket.file(key).getSignedUrl({
      action: "read",
      expires: Date.now() + (options.expiresIn ?? DEFAULT_SIGNED_URL_EXPIRES_IN) * 1000,
    });

    return url;
  }
}

export function gcsStorage(config: GcsStorageConfig): GcsStorageAdapter {
  return new GcsStorageAdapter(config);
}
