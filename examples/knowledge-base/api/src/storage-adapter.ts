import type { StorageAdapter } from "@mantlejs/storage";
import { diskStorage } from "@mantlejs/storage";
import { s3Storage } from "@mantlejs/storage-s3";
import { gcsStorage } from "@mantlejs/storage-gcs";

/** Disk in dev; S3 or GCS when their bucket env var is set (S3 takes precedence). */
export function createStorageAdapter(): StorageAdapter {
  if (process.env.S3_BUCKET) {
    return s3Storage({ bucket: process.env.S3_BUCKET, region: process.env.AWS_REGION ?? "us-east-1" });
  }
  if (process.env.GCS_BUCKET) {
    return gcsStorage({ bucket: process.env.GCS_BUCKET });
  }
  return diskStorage({ destination: process.env.UPLOAD_DIR ?? "./uploads" });
}
