// Copied over src/App.tsx of each freshly scaffolded app by install-smoke.mjs: imports and renders
// every block exactly as a consumer would after `shadcn add`, so `tsc -b && vite build` type-checks
// and bundles all of them against the real installed primitives.
import { mantle } from "@mantlejs/client";
import { MantleProvider } from "@mantlejs/react";
import { AuthProvider } from "@/components/mantle/auth-provider";
import { DataTable } from "@/components/mantle/data-table";
import { LoginForm } from "@/components/mantle/login-form";
import { MantlePagination } from "@/components/mantle/mantle-pagination";
import { OAuthButtons } from "@/components/mantle/oauth-buttons";
import { RealtimeList } from "@/components/mantle/realtime-list";
import { SearchCombobox } from "@/components/mantle/search-combobox";
import { SignupForm } from "@/components/mantle/signup-form";
import { UploadDropzone } from "@/components/mantle/upload-dropzone";

const apiUrl = "http://localhost:3030";
const client = mantle({ url: apiUrl });

interface Article {
  id: number;
  title: string;
  views: number;
}

export default function App() {
  return (
    <MantleProvider client={client}>
      <AuthProvider>
        <main className="mx-auto flex max-w-2xl flex-col gap-8 p-8">
          <LoginForm />
          <SignupForm />
          <OAuthButtons apiUrl={apiUrl} />
          <UploadDropzone url={`${apiUrl}/attachments`} acceptedFileTypes={["image/*"]} maxFileSize={5_000_000} />
          <RealtimeList<Article> service="articles" aria-label="Articles" renderItem={(article) => article.title} />
          <DataTable<Article>
            service="articles"
            aria-label="Articles table"
            pageSize={10}
            columns={[
              { id: "title", header: "Title", sortable: true },
              { id: "views", header: "Views", sortable: true },
            ]}
          />
          <MantlePagination page={{ total: 30, limit: 10, skip: 0 }} onSkipChange={() => undefined} />
          <SearchCombobox<Article> service="articles" field="title" label="Search" onSelect={() => undefined} />
        </main>
      </AuthProvider>
    </MantleProvider>
  );
}
