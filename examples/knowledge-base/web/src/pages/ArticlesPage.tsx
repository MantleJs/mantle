import { useState, type FormEvent } from "react";
import { useCreate, useFind } from "@mantlejs/react";
import type { Paginated } from "@mantlejs/client";
import { client } from "../lib/client.js";
import { localEmbed } from "../lib/local-embed.js";
import { Button } from "../components/ui/button.js";
import { Input } from "../components/ui/input.js";
import { Textarea } from "../components/ui/textarea.js";
import { Card } from "../components/ui/card.js";
import type { Article } from "../types.js";

interface ArticlesPageProps {
  onSelect: (id: number) => void;
}

export function ArticlesPage({ onSelect }: ArticlesPageProps) {
  const [searchResults, setSearchResults] = useState<Array<Article & { _score: number }> | undefined>();
  const [searching, setSearching] = useState(false);
  const [showNewForm, setShowNewForm] = useState(false);
  const [createError, setCreateError] = useState<string | undefined>();

  const articlesQuery = useFind<Article>("articles", { query: { $sort: { createdAt: "desc" } } }, { realtime: true });
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

  const list: Array<Article & { _score?: number }> = searchResults ?? toArray(articlesQuery.data);

  return (
    <div className="mx-auto max-w-2xl">
      <form onSubmit={handleSearch} className="mb-4 flex gap-2">
        <Input name="q" type="search" placeholder="Semantic search…" />
        <Button type="submit" variant="secondary" disabled={searching}>
          {searching ? "Searching…" : "Search"}
        </Button>
        {searchResults && (
          <Button type="button" variant="ghost" onClick={() => setSearchResults(undefined)}>
            Clear
          </Button>
        )}
      </form>

      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">{searchResults ? "Search results" : "Articles"}</h2>
        <Button variant="secondary" onClick={() => setShowNewForm((v) => !v)}>
          {showNewForm ? "Cancel" : "New article"}
        </Button>
      </div>

      {showNewForm && (
        <Card className="mb-4">
          <form onSubmit={handleCreate} className="flex flex-col gap-3">
            <Input name="title" placeholder="Title" required />
            <Textarea name="body" placeholder="Write something…" rows={4} required />
            {createError && <p className="text-sm text-red-600">{createError}</p>}
            <Button type="submit" disabled={createArticle.isPending}>
              Publish
            </Button>
          </form>
        </Card>
      )}

      {articlesQuery.isLoading && !searchResults && <p className="text-sm text-slate-500">Loading…</p>}

      <ul className="flex flex-col gap-2">
        {list.map((article) => (
          <li key={article.id}>
            <Card className="cursor-pointer hover:border-slate-400" onClick={() => onSelect(article.id)}>
              <h3 className="font-medium text-slate-900">{article.title}</h3>
              <p className="mt-1 line-clamp-2 text-sm text-slate-500">{article.body}</p>
              {article._score !== undefined && (
                <p className="mt-1 text-xs text-slate-400">distance: {article._score.toFixed(3)}</p>
              )}
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}

function toArray<T>(data: T[] | Paginated<T> | undefined): T[] {
  if (!data) return [];
  return Array.isArray(data) ? data : data.data;
}
