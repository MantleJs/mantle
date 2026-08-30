import { KnexRepository } from "@mantlejs/knex";
import type { User, Message } from "./entities.js";

export class UserRepository extends KnexRepository<User> {
  readonly tableName = "users";
}

export class MessageRepository extends KnexRepository<Message> {
  readonly tableName = "messages";
}
