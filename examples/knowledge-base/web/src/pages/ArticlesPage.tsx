import { useState, type FormEvent } from "react";
import { Form, GridList, GridListItem, TextField } from "react-aria-components";
import { useCreate } from "@mantlejs/react";
import { client } from "@/lib/client";
import { localEmbed } from "@/lib/local-embed";
import { RealtimeList } from "@/components/mantle/realtime-list";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Article } from "@/types";

interface ArticlesPageProps {
  onSelect: (id: number) => void;
}

function ArticleSummary({ article }: { article: Article & { _score?: number } }) {
  return (
    <>
      <h3 className="font-medium">{article.title}</h3>
      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{article.body}</p>
      {article._score !== undefined && (
        <p className="mt-1 text-xs text-muted-foreground">distance: {article._score.toFixed(3)}</p>
      )}
    </>
  );
}

export function ArticlesPage({ onSelect }: ArticlesPageProps) {
  const [searchResults, setSearchResults] = useState<Array<Article & { _score: number }> | undefined>();
  const [searching, setSearching] = useState(false);
  const [showNewForm, setShowNewForm] = useState(false);
  const [createError, setCreateError] = useState<string | undefined>();
  const createArticle = useCreate<Article>("articles");

  async function handleSearch(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const text = String(new FormData(event.currentTarget).get("q") ?? "").trim();
    if (!text) {
      setSearchResults(undefined);
      return;
    }
    setSearching(true);
    try {
      const results = await client.service<Article>("search").similar({ vector: localEmbed(text), topK: 10 });
      setSearchResults(results);
    } finally {
      setSearching(false);
    }
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setCreateError(undefined);
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      await createArticle.mutateAsync({ title: String(data.get("title")), body: String(data.get("body")) });
      form.reset();
      setShowNewForm(false);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Form onSubmit={handleSearch} className="mb-4 flex gap-2">
        <TextField name="q" type="search" aria-label="Semantic search" className="flex-1">
          <Input placeholder="Semantic search…" />
        </TextField>
        <Button type="submit" variant="secondary" isPending={searching}>
          Search
        </Button>
        {searchResults && (
          <Button variant="ghost" onPress={() => setSearchResults(undefined)}>
            Clear
          </Button>
        )}
      </Form>

      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">{searchResults ? "Search results" : "Articles"}</h2>
        <Button variant="secondary" onPress={() => setShowNewForm((v) => !v)}>
          {showNewForm ? "Cancel" : "New article"}
        </Button>
      </div>

      {showNewForm && (
        <Card className="mb-4">
          <CardContent>
            <Form onSubmit={handleCreate} className="flex flex-col gap-3">
              <TextField name="title" aria-label="Title" isRequired>
                <Input placeholder="Title" />
              </TextField>
              <TextField name="body" aria-label="Body" isRequired>
                <Textarea placeholder="Write something…" rows={4} />
              </TextField>
              {createError && <p className="text-sm text-destructive">{createError}</p>}
              <Button type="submit" isPending={createArticle.isPending}>
                Publish
              </Button>
            </Form>
          </CardContent>
        </Card>
      )}

      {searchResults ? (
        // similar() results aren't a find() — a plain React Aria GridList, styled like the live list.
        <GridList
          aria-label="Search results"
          items={searchResults}
          onAction={(key) => onSelect(Number(key))}
          renderEmptyState={() => <p className="p-4 text-sm text-muted-foreground">No matches.</p>}
          className="flex flex-col gap-1"
        >
          {(article) => (
            <GridListItem
              id={article.id}
              textValue={article.title}
              className="cursor-pointer rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none hover:bg-muted data-focus-visible:ring-3 data-focus-visible:ring-ring/50"
            >
              <ArticleSummary article={article} />
            </GridListItem>
          )}
        </GridList>
      ) : (
        <RealtimeList<Article>
          service="articles"
          aria-label="Articles"
          query={{ $sort: { createdAt: "desc" } }}
          insert="start"
          textValue={(article) => article.title}
          onAction={(article) => onSelect(article.id)}
          renderItem={(article) => <ArticleSummary article={article} />}
          renderEmpty={() => "No articles yet."}
        />
      )}
    </div>
  );
}
