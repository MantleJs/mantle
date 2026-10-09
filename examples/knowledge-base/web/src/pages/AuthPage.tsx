import { useState } from "react";
import { apiUrl } from "@/lib/client";
import { LoginForm } from "@/components/mantle/login-form";
import { SignupForm } from "@/components/mantle/signup-form";
import { OAuthButtons } from "@/components/mantle/oauth-buttons";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/** The strategies api/src/app.ts's configureOAuthStrategies() can register (each only when its env vars are set). */
const OAUTH_PROVIDERS = ["google", "github", "apple", "microsoft", "linkedin"] as const;

export function AuthPage() {
  const [mode, setMode] = useState<"login" | "register">("login");

  // Login, registration, and the OAuth redirect-back (tokens or #error= in the URL fragment) are all
  // handled by the Mantle UI registry blocks + <AuthProvider> in app.tsx; a successful login flips
  // AuthProvider's status, which swaps this page out.
  return (
    <div className="mx-auto mt-16 max-w-sm">
      <h1 className="mb-6 text-center text-2xl font-semibold">Mantle KB</h1>
      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex gap-2 text-sm" role="group" aria-label="Account">
            <Button variant={mode === "login" ? "secondary" : "ghost"} size="sm" onPress={() => setMode("login")}>
              Log in
            </Button>
            <Button variant={mode === "register" ? "secondary" : "ghost"} size="sm" onPress={() => setMode("register")}>
              Register
            </Button>
          </div>

          {mode === "login" ? <LoginForm /> : <SignupForm submitLabel="Register" />}

          <div className="border-t border-border pt-4">
            <p className="mb-2 text-center text-xs text-muted-foreground">Or continue with</p>
            <OAuthButtons apiUrl={apiUrl} providers={[...OAUTH_PROVIDERS]} label={(name) => name} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
