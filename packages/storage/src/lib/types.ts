import type { Readable } from "node:stream";

export interface UploadConfig {
  maxFileSize?: number;
  allowedMimeTypes?: string[];
  storage?: StorageAdapter;
}

export interface DiskStorageConfig {
  destination: string;
  filename?: (info: UploadFileInfo) => string;
}

export interface UploadedFile {
  fieldname: string;
  originalname: string;
  mimetype: string;
  size: number;
  path: string;
  key: string;
}

export interface UploadFileInfo {
  fieldname: string;
  originalname: string;
  mimetype: string;
}

export interface GetSignedUrlOptions {
  expiresIn?: number;
}

export interface StorageAdapter {
  store(stream: Readable, info: UploadFileInfo): Promise<UploadedFile>;
  retrieve(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
  getSignedUrl?(key: string, options?: GetSignedUrlOptions): Promise<string>;
}

export interface HandleUploadOptions {
  required?: boolean;
}

export interface UploadEngine {
  readonly maxFileSize: number;
  readonly allowedMimeTypes: string[];
  readonly storage: StorageAdapter;
}
