import type { HookContext, HookFunction } from "@mantlejs/mantle";
import { BadRequest } from "@mantlejs/mantle";
import type { UploadedFile } from "@mantlejs/storage";

/** Runs after `handleUpload("file")` — reshapes the parsed multipart file into `Attachment` fields. */
export function mapUploadToAttachment(): HookFunction {
  return (context: HookContext) => {
    const data = context.data as { file?: UploadedFile; articleId?: number } | undefined;
    if (!data?.file) {
      throw new BadRequest("Multipart field 'file' is required");
    }
    const { originalname, mimetype, size, key } = data.file;
    const user = context.params.user as { id?: unknown } | undefined;
    context.data = {
      filename: originalname,
      mimetype,
      size,
      key,
      articleId: data.articleId ?? null,
      uploadedBy: user?.id ?? null,
    };
    return context;
  };
}
