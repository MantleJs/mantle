import type { HookContext, HookFunction } from "@mantlejs/mantle";
import { BadRequest } from "@mantlejs/mantle";
import type { UploadedFile } from "@mantlejs/storage";

/** Runs after `handleUpload("file")` — reshapes the parsed multipart file into `Attachment` fields. */
export function mapUploadToAttachment(): HookFunction {
  return (context: HookContext) => {
    // articleId arrives as a plain multipart text field (see handleUpload() in @mantlejs/storage)
    // — always a string, same as a URL-encoded form or query string.
    const data = context.data as { file?: UploadedFile; articleId?: string } | undefined;
    if (!data?.file) {
      throw new BadRequest("Multipart field 'file' is required");
    }
    const { originalname, mimetype, size, key } = data.file;
    const user = context.params.user as { id?: unknown } | undefined;
    const articleId = data.articleId !== undefined ? Number(data.articleId) : NaN;
    context.data = {
      filename: originalname,
      mimetype,
      size,
      key,
      articleId: Number.isInteger(articleId) ? articleId : null,
      uploadedBy: user?.id ?? null,
    };
    return context;
  };
}
