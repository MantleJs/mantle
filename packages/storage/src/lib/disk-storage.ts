import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import path from "node:path";
import type { Readable } from "node:stream";
import { BadRequest } from "@mantlejs/mantle";
import type { DiskStorageConfig, StorageAdapter, UploadedFile, UploadFileInfo } from "./types.js";

export function diskStorage(config: DiskStorageConfig): StorageAdapter {
  return {
    async store(stream: Readable, info: UploadFileInfo): Promise<UploadedFile> {
      await mkdir(config.destination, { recursive: true });

      const filename = config.filename
        ? config.filename(info)
        : `${Date.now()}-${path.basename(info.originalname.replaceAll("\0", ""))}`;
      const filepath = path.join(config.destination, filename);

      // Containment check: originalname (and any user-supplied filename function)
      // is client-controlled, so the resolved path must stay inside the upload root.
      const resolved = path.resolve(filepath);
      if (!resolved.startsWith(path.resolve(config.destination) + path.sep)) {
        throw new BadRequest("Invalid upload filename");
      }

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
