export interface User extends Record<string, unknown> {
  id: number;
  email: string;
  password: string;
  name: string;
  // Column names on this table are snake_case (legacy convention) — see
  // UserRepository's createdAtField/updatedAtField override in repositories.ts.
  created_at?: Date;
  updated_at?: Date;
}

export interface Message extends Record<string, unknown> {
  id: number;
  userId: number;
  text: string;
  createdAt?: Date;
  updatedAt?: Date;
}
