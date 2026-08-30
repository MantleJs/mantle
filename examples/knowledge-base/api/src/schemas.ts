import { Type } from "@mantlejs/schema";

// All fields optional: OAuth-created users (no password) and provider-id fields flow
// through the same `users.create()` path as local registration.
export const userCreateSchema = Type.Object({
  email: Type.Optional(Type.String({ format: "email" })),
  password: Type.Optional(Type.String({ minLength: 8 })),
  name: Type.Optional(Type.String({ minLength: 1 })),
});

export const articleCreateSchema = Type.Object({
  title: Type.String({ minLength: 1, maxLength: 200 }),
  body: Type.String({ minLength: 1 }),
});

export const commentCreateSchema = Type.Object({
  articleId: Type.Integer(),
  body: Type.String({ minLength: 1 }),
});
