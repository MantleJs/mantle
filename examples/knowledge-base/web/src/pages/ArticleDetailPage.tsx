import { useRef, useState, type FormEvent } from "react";
import { useCreate, useFind, useGet } from "@mantlejs/react";
import type { Paginated } from "@mantlejs/client";
import { apiUrl, client } from "../lib/client.js";
import { Button } from "../components/ui/button.js";
import { Input } from "../components/ui/input.js";
import { Card } from "../components/ui/card.js";
import type { Article, Attachment, Comment } from "../types.js";

interface ArticleDetailPageProps {
  articleId: number;
  onBack: () => void;
}

function toArray<T>(data: T[] | Paginated<T> | undefined): T[] {
  if (!data) return [];
  return Array.isArray(data) ? data : data.data;
}

export function ArticleDetailPage({ articleId, onBack }: ArticleDetailPageProps) {
  const article = useGet<Article>("articles", articleId);
  const comments = useFind<Comment>(
    "comments",
    { query: { articleId, $sort: { createdAt: "asc" } } },
    { realtime: true },
  );
  const attachments = useFind<Attachment>("attachments", { query: { articleId } });
  const createComment = useCreate<Comment>("comments");
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleComment(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = String(form.get("body") ?? "").trim();
    if (!body) return;
    await createComment.mutateAsync({ articleId, body } as Partial<Comment>);
    (event.target as HTMLFormElement).reset();
  }

  async function handleUpload(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const file = fileInput.current?.files?.[0];
    if (!file) return;
    const body = new FormData();
    body.append("file", file);
    body.append("articleId", String(articleId));
    const token = client.getAccessToken();
    setUploading(true);
    try {
      await fetch(`${apiUrl}/attachments`, {
        method: "POST",
        headers: token ? { authorization: `Bearer ${token}` } : {},
        body,
      });
      await attachments.refetch();
      (event.target as HTMLFormElement).reset();
    } finally {
      setUploading(false);
    }
  }

  if (article.isLoading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (article.isError || !article.data) return <p className="text-sm text-red-600">Article not found.</p>;

  return (
    <div className="mx-auto max-w-2xl">
      <Button variant="ghost" onClick={onBack} className="mb-4 -ml-3">
        ← Back
      </Button>

      <Card className="mb-6">
        <h1 className="text-xl font-semibold text-slate-900">{article.data.title}</h1>
        <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">{article.data.body}</p>
      </Card>

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold text-slate-900">Attachments</h2>
        <ul className="mb-2 flex flex-col gap-1">
          {toArray(attachments.data).map((file) => (
            <li key={file.id} className="text-sm text-slate-600">
              {file.filename} <span className="text-xs text-slate-400">({file.mimetype}, {file.size}B)</span>
            </li>
          ))}
        </ul>
        <form onSubmit={handleUpload} className="flex gap-2">
          <input ref={fileInput} type="file" name="file" className="text-sm" />
          <Button type="submit" variant="secondary" disabled={uploading}>
            {uploading ? "Uploading…" : "Upload"}
          </Button>
        </form>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-900">Comments</h2>
        <ul className="mb-3 flex flex-col gap-2">
          {toArray(comments.data).map((comment) => (
            <li key={comment.id} className="rounded-md bg-slate-50 p-2 text-sm text-slate-700">
              {comment.body}
            </li>
          ))}
        </ul>
        <form onSubmit={handleComment} className="flex gap-2">
          <Input name="body" placeholder="Add a comment…" />
          <Button type="submit" disabled={createComment.isPending}>
            Post
          </Button>
        </form>
      </section>
    </div>
  );
}
