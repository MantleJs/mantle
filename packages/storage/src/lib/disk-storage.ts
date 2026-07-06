import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import path from "node:path";
import type { Readable } from "node:stream";
import type { DiskStorageConfig, StorageAdapter, UploadedFile, UploadFileInfo } from "./types.js";

export function diskStorage(config: DiskStorageConfig): StorageAdapter {
  return {
    async store(stream: Readable, info: UploadFileInfo): Promise<UploadedFile> {
      await mkdir(config.destination, { recursive: true });

      const filename = config.filename ? config.filename(info) : `${Date.now()}-${info.originalname}`;
      const filepath = path.join(config.destination, filename);
      let size = 0;

      const counter = new Transform({
        transform(chunk, _encoding, callback) {
          size += (chunk as Buffer).length;
          callback(null, chunk as Buffer);
        },
      });

      await pipeline(stream, counter, createWriteStream(filepath));

      return {
        fieldname: info.fieldname,
        originalname: info.originalname,
        mimetype: info.mimetype,
        size,
        path: filepath,
      };
    },
  };
}
