export interface Comment extends Record<string, unknown> {
  id: number;
  articleId: number;
  authorId: number;
  body: string;
  createdAt?: Date;
  updatedAt?: Date;
}
