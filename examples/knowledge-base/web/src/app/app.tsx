import { useEffect, useState } from "react";
import { MantleProvider } from "@mantlejs/react";
import { client } from "../lib/client.js";
import { AuthPage } from "../pages/AuthPage.js";
import { ArticlesPage } from "../pages/ArticlesPage.js";
import { ArticleDetailPage } from "../pages/ArticleDetailPage.js";
import { Button } from "../components/ui/button.js";

type View = { name: "list" } | { name: "article"; id: number };

function Shell() {
  // undefined = still checking for a persisted session. getAccessToken() is synchronous and
  // reads only the in-memory copy, which is empty on a fresh page load until something hydrates
  // it from storage — checking it here would show the login page on every refresh even with a
  // valid session saved. isAuthenticated() hydrates first; see @mantlejs/client's README.
  const [authenticated, setAuthenticated] = useState<boolean | undefined>(undefined);
  const [view, setView] = useState<View>({ name: "list" });

  useEffect(() => {
    let cancelled = false;
    void client.isAuthenticated().then((result) => {
      if (!cancelled) setAuthenticated(result);
    });

    const onAuthenticated = () => setAuthenticated(true);
    const onLogout = () => setAuthenticated(false);
    client.on("authenticated", onAuthenticated);
    client.on("logout", onLogout);
    return () => {
      cancelled = true;
      client.off("authenticated", onAuthenticated);
      client.off("logout", onLogout);
    };
  }, []);

  if (authenticated === undefined) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-8">
        <p className="text-sm text-slate-500">Loading…</p>
      </main>
    );
  }

  if (!authenticated) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-8">
        <AuthPage />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8">
      <header className="mx-auto mb-6 flex max-w-2xl items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900">Mantle KB</h1>
        <Button variant="ghost" onClick={() => void client.logout()}>
          Log out
        </Button>
      </header>
      {view.name === "list" ? (
        <ArticlesPage onSelect={(id) => setView({ name: "article", id })} />
      ) : (
        <ArticleDetailPage articleId={view.id} onBack={() => setView({ name: "list" })} />
      )}
    </main>
  );
}

export function App() {
  return (
    <MantleProvider client={client}>
      <Shell />
    </MantleProvider>
  );
}

export default App;
