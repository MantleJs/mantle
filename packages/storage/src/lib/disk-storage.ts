import { createWriteStream, createReadStream } from "node:fs";
import { mkdir, unlink } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import path from "node:path";
import type { Readable } from "node:stream";
import { BadRequest, NotFound } from "@mantlejs/mantle";
import type { DiskStorageConfig, StorageAdapter, UploadedFile, UploadFileInfo } from "./types.js";

// Containment check: keys are either derived from client-controlled originalname
// (and any user-supplied filename function) or passed back in by the caller, so the
// resolved path must stay inside the upload root.
function resolveSafePath(destination: string, key: string): string {
  const resolvedDestination = path.resolve(destination);
  const resolved = path.resolve(destination, key);
  if (resolved !== resolvedDestination && !resolved.startsWith(resolvedDestination + path.sep)) {
    throw new BadRequest("Invalid storage key");
  }
  return resolved;
}

export function diskStorage(config: DiskStorageConfig): StorageAdapter {
  return {
    async store(stream: Readable, info: UploadFileInfo): Promise<UploadedFile> {
      await mkdir(config.destination, { recursive: true });

      const filename = config.filename
        ? config.filename(info)
        : `${Date.now()}-${path.basename(info.originalname.replaceAll("\0", ""))}`;
      const filepath = resolveSafePath(config.destination, filename);

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
        key: filename,
      };
    },

    async retrieve(key: string): Promise<Readable> {
      const filepath = resolveSafePath(config.destination, key);
      return createReadStream(filepath);
    },

    async delete(key: string): Promise<void> {
      const filepath = resolveSafePath(config.destination, key);
      try {
        await unlink(filepath);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          throw new NotFound(`Storage key '${key}' not found`);
        }
        throw err;
      }
    },
  };
}
