import { KnexRepository } from "@mantlejs/knex";
import type { Comment } from "../entities/comment.js";

export class CommentRepository extends KnexRepository<Comment> {
  readonly tableName = "comments";
}
