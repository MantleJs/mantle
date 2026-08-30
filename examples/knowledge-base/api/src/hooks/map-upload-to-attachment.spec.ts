import { describe, expect, it } from "vitest";
import type { HookContext } from "@mantlejs/mantle";
import { BadRequest } from "@mantlejs/mantle";
import { mapUploadToAttachment } from "./map-upload-to-attachment.js";

describe("mapUploadToAttachment()", () => {
  it("reshapes the parsed upload into Attachment fields", () => {
    const ctx = {
      params: { user: { id: 3 } },
      data: {
        articleId: 9,
        file: { fieldname: "file", originalname: "notes.pdf", mimetype: "application/pdf", size: 1024, path: "/tmp/x", key: "abc123" },
      },
    } as unknown as HookContext;

    const result = mapUploadToAttachment()(ctx) as HookContext;

    expect(result.data).toEqual({
      filename: "notes.pdf",
      mimetype: "application/pdf",
      size: 1024,
      key: "abc123",
      articleId: 9,
      uploadedBy: 3,
    });
  });

  it("defaults articleId to null and uploadedBy to null when absent", () => {
    const ctx = {
      params: {},
      data: { file: { fieldname: "file", originalname: "a.txt", mimetype: "text/plain", size: 1, path: "/tmp/a", key: "k" } },
    } as unknown as HookContext;

    const result = mapUploadToAttachment()(ctx) as HookContext;

    expect(result.data).toMatchObject({ articleId: null, uploadedBy: null });
  });

  it("throws BadRequest when no file was uploaded", () => {
    const ctx = { params: {}, data: {} } as unknown as HookContext;
    expect(() => mapUploadToAttachment()(ctx)).toThrow(BadRequest);
  });
});
