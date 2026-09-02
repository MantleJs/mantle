export interface User extends Record<string, unknown> {
  id: number;
  email: string;
  password: string;
  name: string;
  // The `users` table's columns are snake_case (legacy convention) — see
  // UserRepository's columnCase override in repositories.ts. The entity stays
  // camelCase like every other entity; KnexRepository translates both ways.
  createdAt?: Date;
  updatedAt?: Date;
}

export interface Message extends Record<string, unknown> {
  id: number;
  userId: number;
  text: string;
  createdAt?: Date;
  updatedAt?: Date;
}
