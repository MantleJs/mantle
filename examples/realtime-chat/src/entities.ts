export interface User extends Record<string, unknown> {
  id: number;
  email: string;
  password: string;
  name: string;
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
