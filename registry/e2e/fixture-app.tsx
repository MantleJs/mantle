// Copied over src/App.tsx of each freshly scaffolded app by install-smoke.mjs: imports and renders
// every block exactly as a consumer would after `shadcn add`, so `tsc -b && vite build` type-checks
// and bundles all of them against the real installed primitives.
import { mantle } from "@mantlejs/client";
import { MantleProvider } from "@mantlejs/react";
import { AuthProvider } from "@/components/mantle/auth-provider";
import { LoginForm } from "@/components/mantle/login-form";
import { OAuthButtons } from "@/components/mantle/oauth-buttons";
import { SignupForm } from "@/components/mantle/signup-form";

const apiUrl = "http://localhost:3030";
const client = mantle({ url: apiUrl });

export default function App() {
  return (
    <MantleProvider client={client}>
      <AuthProvider>
        <main className="mx-auto flex max-w-2xl flex-col gap-8 p-8">
          <LoginForm />
          <SignupForm />
          <OAuthButtons apiUrl={apiUrl} />
        </main>
      </AuthProvider>
    </MantleProvider>
  );
}
