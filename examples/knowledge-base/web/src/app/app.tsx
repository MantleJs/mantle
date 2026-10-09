import { useState } from "react";
import { MantleProvider } from "@mantlejs/react";
import { client } from "@/lib/client";
import { AuthProvider, useAuth } from "@/components/mantle/auth-provider";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { AuthPage } from "@/pages/AuthPage";
import { ArticlesPage } from "@/pages/ArticlesPage";
import { ArticleDetailPage } from "@/pages/ArticleDetailPage";

type View = { name: "list" } | { name: "article"; id: number };

function Shell() {
  // AuthProvider resolves the persisted-session check (and any OAuth redirect fragment) on mount;
  // "loading" until then, so a valid saved session never flashes the login page.
  const { status, logout } = useAuth();
  const [view, setView] = useState<View>({ name: "list" });

  if (status === "loading") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <Spinner />
      </main>
    );
  }

  if (status === "unauthenticated") {
    return (
      <main className="min-h-screen bg-background px-4 py-8">
        <AuthPage />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background px-4 py-8">
      <header className="mx-auto mb-6 flex max-w-2xl items-center justify-between">
        <h1 className="text-lg font-semibold">Mantle KB</h1>
        <Button variant="ghost" onPress={() => void logout()}>
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
      <AuthProvider>
        <Shell />
      </AuthProvider>
    </MantleProvider>
  );
}

export default App;
