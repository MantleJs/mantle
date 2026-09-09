import busboy from "busboy";
import type { IncomingMessage } from "node:http";
import type { Readable } from "node:stream";
import type { HookContext, HookFunction } from "@mantlejs/mantle";
import { BadRequest } from "@mantlejs/mantle";
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

    const { file: uploadedFile, fields } = await parseMultipart(req, field, engine);

    if (!uploadedFile) {
      if (options.required) {
        throw new BadRequest(`Upload field '${field}' is required`);
      }
      context.data = { ...(context.data as Record<string, unknown>), ...fields };
      return context;
    }

    context.data = { ...(context.data as Record<string, unknown>), ...fields, [field]: uploadedFile };
    return context;
  };
}

interface ParsedMultipart {
  file: UploadedFile | null;
  /** Ordinary (non-file) multipart fields, e.g. `articleId` sent alongside a `file` part — always
   * strings, same as a URL-encoded form or query string; the caller coerces types as needed. */
  fields: Record<string, string>;
}

function parseMultipart(req: IncomingMessage, fieldname: string, engine: UploadEngine): Promise<ParsedMultipart> {
  const bb = busboy({
    headers: req.headers,
    limits: { fileSize: engine.maxFileSize },
  });
  const fields: Record<string, string> = {};

  return new Promise<ParsedMultipart>((resolve, reject) => {
    let settled = false;
    let fileFound = false;
    let filePromise: Promise<UploadedFile> | undefined;

    const settle = (fn: () => void): void => {
      if (!settled) {
        settled = true;
        fn();
      }
    };

    bb.on("field", (name: string, value: string) => {
      fields[name] = value;
    });

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

      // Resolved/rejected from "close" below, once the whole body (including any fields
      // that follow this file part) has been parsed — not here, to avoid a race where
      // store() finishes before busboy reaches a field that comes after the file in the
      // multipart body.
      filePromise = engine.storage.store(stream, uploadInfo).then((file) => {
        if (stream.truncated) {
          throw new BadRequest(`File exceeds the maximum allowed size of ${engine.maxFileSize} bytes`);
        }
        return file;
      });
      filePromise.catch(() => undefined); // observed below; avoids an unhandled-rejection warning if "close" never settles it first
    });

    bb.on("close", () => {
      if (!fileFound) {
        settle(() => resolve({ file: null, fields }));
        return;
      }
      // Absent when the matched file was already rejected synchronously (e.g. a disallowed
      // MIME type) before storage.store() was ever called — that rejection already settled us.
      if (!filePromise) return;
      filePromise.then(
        (file) => settle(() => resolve({ file, fields })),
        (err: unknown) => settle(() => reject(err instanceof Error ? err : new Error(String(err)))),
      );
    });

    bb.on("error", (err: unknown) => settle(() => reject(err instanceof Error ? err : new Error(String(err)))));

    req.pipe(bb);
  });
}
