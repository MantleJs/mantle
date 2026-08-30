export interface Article extends Record<string, unknown> {
  id: number;
  title: string;
  body: string;
  authorId: number;
  createdAt?: Date;
  updatedAt?: Date;
}
