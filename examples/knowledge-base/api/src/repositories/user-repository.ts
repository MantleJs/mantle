import { KnexRepository } from "@mantlejs/knex";
import type { User } from "../entities/user.js";

export class UserRepository extends KnexRepository<User> {
  readonly tableName = "users";
}
