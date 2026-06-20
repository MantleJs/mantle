import busboy from "busboy";
import type { IncomingMessage } from "node:http";
import type { Readable } from "node:stream";
import type { HookContext, HookFunction } from "@mantlejs/core";
import { BadRequest } from "@mantlejs/core";
import type { HandleUploadOptions, UploadedFile, UploadEngine, UploadFileInfo } from "./types.js";

export function handleUpload(field: string, options: HandleUploadOptions = {}): HookFunction {
  return async (context: HookContext): Promise<HookContext> => {
    const engine = context.app.get<UploadEngine>("upload");
    const req = context.params["request"] as IncomingMessage | undefined;

    if (!req) {
      if (options.required) {
        throw new BadRequest(`Upload field '${field}' is required`);
      }
      return context;
    }

    const uploadedFile = await parseMultipart(req, field, engine);

    if (!uploadedFile) {
      if (options.required) {
        throw new BadRequest(`Upload field '${field}' is required`);
      }
      return context;
    }

    context.data = { ...(context.data as Record<string, unknown>), [field]: uploadedFile };
    return context;
  };
}

function parseMultipart(req: IncomingMessage, fieldname: string, engine: UploadEngine): Promise<UploadedFile | null> {
  const bb = busboy({
    headers: req.headers,
    limits: { fileSize: engine.maxFileSize },
  });

  return new Promise<UploadedFile | null>((resolve, reject) => {
    let settled = false;
    let fileFound = false;

    const settle = (fn: () => void): void => {
      if (!settled) {
        settled = true;
        fn();
      }
    };

    bb.on("file", (name: string, stream: Readable & { truncated?: boolean }, info) => {
      if (name !== fieldname) {
        stream.resume();
        return;
      }

      fileFound = true;

      if (engine.allowedMimeTypes.length > 0 && !engine.allowedMimeTypes.includes(info.mimeType)) {
        stream.resume();
        settle(() => reject(new BadRequest(`File type '${info.mimeType}' is not allowed`)));
        return;
      }

      const uploadInfo: UploadFileInfo = {
        fieldname: name,
        originalname: info.filename,
        mimetype: info.mimeType,
      };

      engine.storage
        .store(stream, uploadInfo)
        .then((file) => {
          if (stream.truncated) {
            settle(() =>
              reject(new BadRequest(`File exceeds the maximum allowed size of ${engine.maxFileSize} bytes`)),
            );
          } else {
            settle(() => resolve(file));
          }
        })
        .catch((err: unknown) => settle(() => reject(err instanceof Error ? err : new Error(String(err)))));
    });

    // Resolve null only when no matching file field was encountered; if a file was
    // found, wait for the async store() operation to complete instead.
    bb.on("close", () => {
      if (!fileFound) settle(() => resolve(null));
    });

    bb.on("error", (err: unknown) => settle(() => reject(err instanceof Error ? err : new Error(String(err)))));

    req.pipe(bb);
  });
}
