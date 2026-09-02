import { KnexRepository } from "@mantlejs/knex";
import type { User, Message } from "./entities.js";

export class UserRepository extends KnexRepository<User> {
  readonly tableName = "users";
  // Demonstrates a per-repository naming override — this table's columns are
  // snake_case while `messages` (below) keeps the default camelCase. The `User`
  // entity itself stays camelCase either way; only the columns differ.
  override readonly columnCase = "snake_case" as const;
}

export class MessageRepository extends KnexRepository<Message> {
  readonly tableName = "messages";
}
