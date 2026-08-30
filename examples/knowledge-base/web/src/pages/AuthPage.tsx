import { useState, type FormEvent } from "react";
import { useCreate } from "@mantlejs/react";
import { client, apiUrl } from "../lib/client.js";
import { Button } from "../components/ui/button.js";
import { Input } from "../components/ui/input.js";
import { Card } from "../components/ui/card.js";
import type { User } from "../types.js";

const OAUTH_PROVIDERS = [
  { key: "google", label: "Google" },
  { key: "github", label: "GitHub" },
  { key: "apple", label: "Apple" },
  { key: "microsoft", label: "Microsoft" },
  { key: "linkedin", label: "LinkedIn" },
];

export function AuthPage() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [error, setError] = useState<string | undefined>();
  const registerUser = useCreate<User>("users");

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(undefined);
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email"));
    const password = String(form.get("password"));

    try {
      if (mode === "register") {
        await registerUser.mutateAsync({ email, password, name: String(form.get("name")) } as Partial<User>);
      }
      await client.authenticate({ strategy: "local", email, password });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  return (
    <div className="mx-auto mt-16 max-w-sm">
      <h1 className="mb-6 text-center text-2xl font-semibold text-slate-900">Mantle KB</h1>
      <Card>
        <div className="mb-4 flex gap-2 text-sm">
          <button
            type="button"
            onClick={() => setMode("login")}
            className={mode === "login" ? "font-semibold text-slate-900" : "text-slate-500"}
          >
            Log in
          </button>
          <span className="text-slate-300">/</span>
          <button
            type="button"
            onClick={() => setMode("register")}
            className={mode === "register" ? "font-semibold text-slate-900" : "text-slate-500"}
          >
            Register
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {mode === "register" && <Input name="name" type="text" placeholder="Name" required />}
          <Input name="email" type="email" placeholder="Email" required />
          <Input name="password" type="password" placeholder="Password" required minLength={8} />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button type="submit">{mode === "login" ? "Log in" : "Register"}</Button>
        </form>

        <div className="mt-6 border-t border-slate-200 pt-4">
          <p className="mb-2 text-center text-xs text-slate-400">Or continue with</p>
          <div className="flex flex-wrap justify-center gap-2">
            {OAUTH_PROVIDERS.map((provider) => (
              <a
                key={provider.key}
                href={`${apiUrl}/auth/${provider.key}`}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
              >
                {provider.label}
              </a>
            ))}
          </div>
        </div>
      </Card>
    </div>
  );
}
