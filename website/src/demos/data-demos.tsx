import { useState } from "react";
import type { MantleClient } from "@mantlejs/client";
import { DataTable } from "@/components/mantle/data-table";
import { MantlePagination } from "@/components/mantle/mantle-pagination";
import { RealtimeList } from "@/components/mantle/realtime-list";
import { SearchCombobox } from "@/components/mantle/search-combobox";
import { Button } from "@/components/ui/button";
import { createDemoClient, createFakeSocket, DemoLog, DemoShell, type FakeSocket } from "./demo-shell";
import { serverCreate, serverPatch, serverRemove, serverRows, type Article } from "./mock-api";

export function RealtimeListDemo() {
  const [{ socket, client }] = useState<{ socket: FakeSocket; client: MantleClient }>(() => {
    const fake = createFakeSocket();
    return { socket: fake, client: createDemoClient(fake) };
  });
  const [counter, setCounter] = useState(1);

  // What another client's write looks like from here: the server applies it, then broadcasts the event.
  const create = () => {
    socket.emit(
      "articles created",
      serverCreate("articles", { title: `Breaking: event #${counter}`, author: "You", views: 0 }),
    );
    setCounter((n) => n + 1);
  };
  const patchFirst = () => {
    const first = serverRows("articles")[0];
    const patched = first && serverPatch("articles", first.id, { title: `${String(first.title)} (edited)` });
    if (patched) socket.emit("articles patched", { ...patched });
  };
  const removeLast = () => {
    const rows = serverRows("articles");
    const removed = rows.length > 0 ? serverRemove("articles", rows[rows.length - 1].id) : undefined;
    if (removed) socket.emit("articles removed", removed);
  };

  return (
    <DemoShell
      client={client}
      footer={
        <>
          The buttons play the server: they change the mock database and push a <code>created</code>/
          <code>patched</code>/<code>removed</code> event down the (fake) socket. The list applies each event to its
          cached page in place — watch the network: there is no refetch.
        </>
      }
    >
      <div className="mb-4 flex flex-wrap gap-2">
        <Button size="sm" onPress={create}>
          Simulate created
        </Button>
        <Button size="sm" variant="outline" onPress={patchFirst}>
          Simulate patched
        </Button>
        <Button size="sm" variant="outline" onPress={removeLast}>
          Simulate removed
        </Button>
      </div>
      <RealtimeList<Article>
        service="articles"
        aria-label="Articles"
        query={{ $limit: 50 }}
        textValue={(article) => article.title}
        renderItem={(article) => (
          <span className="flex w-full justify-between gap-4">
            <span>{article.title}</span>
            <span className="text-muted-foreground">{article.author}</span>
          </span>
        )}
        className="max-h-80 overflow-auto"
      />
    </DemoShell>
  );
}

export function DataTableDemo() {
  return (
    <DemoShell
      footer={
        <>
          Sorting and paging happen server-side: each header click sends <code>$sort</code>, each page sends{" "}
          <code>$skip</code>/<code>$limit</code>, and only the shown fields are requested with <code>$select</code>.
        </>
      }
    >
      <DataTable<Article>
        service="articles"
        aria-label="Articles"
        pageSize={5}
        defaultSort={{ field: "views", direction: "desc" }}
        columns={[
          { id: "title", header: "Title", sortable: true },
          { id: "author", header: "Author", sortable: true },
          { id: "views", header: "Views", sortable: true },
        ]}
      />
    </DemoShell>
  );
}

export function MantlePaginationDemo() {
  const [skip, setSkip] = useState(40);
  const page = { total: 237, limit: 10, skip };
  return (
    <DemoShell
      footer={
        <>
          Driven by a <code>Paginated&lt;T&gt;</code> envelope — here <code>{JSON.stringify(page)}</code>. Picking a
          page calls <code>onSkipChange</code> with the new <code>$skip</code>.
        </>
      }
    >
      <MantlePagination page={page} onSkipChange={setSkip} />
    </DemoShell>
  );
}

export function SearchComboboxDemo() {
  const [service, setService] = useState<"articles" | "notes">("articles");
  const [log, setLog] = useState<string[]>([]);
  return (
    <DemoShell
      footer={
        <>
          Type two or more characters (try <code>mcp</code> or <code>auth</code>). <code>articles</code> is backed by an
          adapter with <code>$ilike</code>; <code>notes</code> simulates one without it — the first query gets the
          adapter's <code>BadRequest</code> and the block falls back to <code>$like</code> for the rest of the session.
        </>
      }
    >
      <div className="mb-4 flex gap-2">
        {(["articles", "notes"] as const).map((name) => (
          <Button
            key={name}
            size="sm"
            variant={service === name ? "default" : "outline"}
            onPress={() => setService(name)}
          >
            {name === "articles" ? "articles ($ilike)" : "notes (no $ilike)"}
          </Button>
        ))}
      </div>
      <SearchCombobox<Article>
        key={service}
        service={service}
        field="title"
        label="Search titles"
        placeholder="Search…"
        onSelect={(article) => setLog((l) => [...l, `onSelect → #${article.id} ${article.title}`])}
      />
      <DemoLog entries={log} />
    </DemoShell>
  );
}
