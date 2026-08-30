export interface User {
  id: number;
  email: string | null;
  name: string | null;
}

export interface Article {
  id: number;
  title: string;
  body: string;
  authorId: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface Comment {
  id: number;
  articleId: number;
  authorId: number;
  body: string;
  createdAt?: string;
}

export interface Attachment {
  id: number;
  articleId: number | null;
  filename: string;
  mimetype: string;
  size: number;
  key: string;
  uploadedBy: number | null;
}
