import { KnexRepository } from "@mantlejs/knex";
import type { Attachment } from "../entities/attachment.js";

export class AttachmentRepository extends KnexRepository<Attachment> {
  readonly tableName = "attachments";
}
