import { useEffect, useState } from "react";
import { MantleProvider } from "@mantlejs/react";
import { client } from "../lib/client.js";
import { AuthPage } from "../pages/AuthPage.js";
import { ArticlesPage } from "../pages/ArticlesPage.js";
import { ArticleDetailPage } from "../pages/ArticleDetailPage.js";
import { Button } from "../components/ui/button.js";

type View = { name: "list" } | { name: "article"; id: number };

function Shell() {
  const [authenticated, setAuthenticated] = useState(() => client.getAccessToken() !== undefined);
  const [view, setView] = useState<View>({ name: "list" });

  useEffect(() => {
    const onAuthenticated = () => setAuthenticated(true);
    const onLogout = () => setAuthenticated(false);
    client.on("authenticated", onAuthenticated);
    client.on("logout", onLogout);
    return () => {
      client.off("authenticated", onAuthenticated);
      client.off("logout", onLogout);
    };
  }, []);

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
