export interface Attachment extends Record<string, unknown> {
  id: number;
  articleId: number | null;
  filename: string;
  mimetype: string;
  size: number;
  key: string;
  uploadedBy: number | null;
  createdAt?: Date;
  updatedAt?: Date;
}
