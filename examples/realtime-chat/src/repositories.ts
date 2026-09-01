import { KnexRepository } from "@mantlejs/knex";
import type { User, Message } from "./entities.js";

export class UserRepository extends KnexRepository<User> {
  readonly tableName = "users";
  // Demonstrates a per-repository naming override — this table uses snake_case
  // timestamp columns while `messages` (below) keeps the default camelCase.
  override readonly createdAtField = "created_at";
  override readonly updatedAtField = "updated_at";
}

export class MessageRepository extends KnexRepository<Message> {
  readonly tableName = "messages";
}
