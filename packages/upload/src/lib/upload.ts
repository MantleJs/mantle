import type { MantleApplication, MantlePlugin } from "@mantlejs/core";
import type { UploadConfig, UploadEngine } from "./types.js";
import { diskStorage } from "./disk-storage.js";

const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024;

export function upload(config: UploadConfig = {}): MantlePlugin {
  return (app: MantleApplication): void => {
    const engine: UploadEngine = {
      maxFileSize: config.maxFileSize ?? DEFAULT_MAX_FILE_SIZE,
      allowedMimeTypes: config.allowedMimeTypes ?? [],
      storage: config.storage ?? diskStorage({ destination: "./uploads" }),
    };
    app.set("upload", engine);
  };
}
