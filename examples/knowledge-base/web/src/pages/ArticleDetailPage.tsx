import type { FormEvent } from "react";
import { Form, TextField } from "react-aria-components";
import { useCreate, useFind, useGet } from "@mantlejs/react";
import type { Paginated } from "@mantlejs/client";
import { apiUrl } from "@/lib/client";
import { RealtimeList } from "@/components/mantle/realtime-list";
import { UploadDropzone } from "@/components/mantle/upload-dropzone";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import type { Article, Attachment, Comment } from "@/types";

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
  const attachments = useFind<Attachment>("attachments", { query: { articleId } });
  const createComment = useCreate<Comment>("comments");

  async function handleComment(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget;
    const body = String(new FormData(form).get("body") ?? "").trim();
    if (!body) return;
    await createComment.mutateAsync({ articleId, body } as Partial<Comment>);
    form.reset();
  }

  if (article.isLoading) return <Spinner />;
  if (article.isError || !article.data) return <p className="text-sm text-destructive">Article not found.</p>;

  return (
    <div className="mx-auto max-w-2xl">
      <Button variant="ghost" onPress={onBack} className="mb-4 -ml-3">
        ← Back
      </Button>

      <Card className="mb-6">
        <CardContent>
          <h1 className="text-xl font-semibold">{article.data.title}</h1>
          <p className="mt-3 text-sm whitespace-pre-wrap">{article.data.body}</p>
        </CardContent>
      </Card>

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold">Attachments</h2>
        <ul className="mb-2 flex flex-col gap-1">
          {toArray(attachments.data).map((file) => (
            <li key={file.id} className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                {file.filename}{" "}
                <span className="text-xs">
                  ({file.mimetype}, {file.size}B)
                </span>
              </span>
              <a
                href={`${apiUrl}/attachments/${file.id}/download`}
                className="text-xs font-medium text-foreground underline hover:no-underline"
              >
                Download
              </a>
            </li>
          ))}
        </ul>
        {/* handleUpload("file") on attachments.create; articleId rides along as an ordinary form field. */}
        <UploadDropzone
          service="attachments"
          fields={{ articleId: String(articleId) }}
          label="Drop a file to attach it"
          onUploaded={() => void attachments.refetch()}
        />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">Comments</h2>
        <RealtimeList<Comment>
          service="comments"
          aria-label="Comments"
          query={{ articleId, $sort: { createdAt: "asc" } }}
          matches={(comment) => comment.articleId === articleId}
          textValue={(comment) => comment.body}
          renderItem={(comment) => comment.body}
          renderEmpty={() => "No comments yet."}
          className="mb-3"
        />
        <Form onSubmit={handleComment} className="flex gap-2">
          <TextField name="body" aria-label="Comment" className="flex-1">
            <Input placeholder="Add a comment…" />
          </TextField>
          <Button type="submit" isPending={createComment.isPending}>
            Post
          </Button>
        </Form>
      </section>
    </div>
  );
}
