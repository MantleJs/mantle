export interface User extends Record<string, unknown> {
  id: number;
  email: string | null;
  password: string | null;
  name: string | null;
  googleId: string | null;
  githubId: string | null;
  appleId: string | null;
  microsoftId: string | null;
  linkedinId: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}
