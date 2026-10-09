import { useState, type MouseEvent } from "react";
import { AuthProvider, useAuth } from "@/components/mantle/auth-provider";
import { LoginForm } from "@/components/mantle/login-form";
import { OAuthButtons } from "@/components/mantle/oauth-buttons";
import { SignupForm } from "@/components/mantle/signup-form";
import { Button } from "@/components/ui/button";
import { DemoLog, DemoShell } from "./demo-shell";
import { DEMO_API, DEMO_EMAIL, DEMO_PASSWORD } from "./mock-api";

function SessionStatus() {
  const { status, user, logout } = useAuth();
  const email = (user as { email?: string } | undefined)?.email;
  return (
    <div className="mt-4 flex items-center justify-between gap-3 text-sm">
      <span>
        Session: <strong>{status}</strong>
        {email ? ` as ${email}` : ""}
      </span>
      {status === "authenticated" && (
        <Button variant="outline" size="sm" onPress={() => void logout()}>
          Log out
        </Button>
      )}
    </div>
  );
}

export function LoginFormDemo() {
  const [log, setLog] = useState<string[]>([]);
  return (
    <DemoShell
      footer={
        <>
          Log in as <code>{DEMO_EMAIL}</code> / <code>{DEMO_PASSWORD}</code>. Any other password gets the server's 401{" "}
          <code>NotAuthenticated</code>, shown as a form-level alert.
        </>
      }
    >
      <AuthProvider>
        <LoginForm onSuccess={(result) => setLog((l) => [...l, `onSuccess → accessToken ${result.accessToken}`])} />
        <SessionStatus />
        <DemoLog entries={log} />
      </AuthProvider>
    </DemoShell>
  );
}

export function SignupFormDemo() {
  const [log, setLog] = useState<string[]>([]);
  return (
    <DemoShell
      footer={
        <>
          Creates the user through <code>POST /users</code>, then logs in. <code>{DEMO_EMAIL}</code> already exists (409{" "}
          <code>Conflict</code> → form alert); passwords under 8 characters fail client-side; the mock server's schema
          rejects malformed emails with a 422 <code>Unprocessable</code> that lands on the email field.
        </>
      }
    >
      <AuthProvider>
        <SignupForm onSuccess={(result) => setLog((l) => [...l, `onSuccess → accessToken ${result.accessToken}`])} />
        <SessionStatus />
        <DemoLog entries={log} />
      </AuthProvider>
    </DemoShell>
  );
}

export function OAuthButtonsDemo() {
  const [log, setLog] = useState<string[]>([]);
  // The buttons are plain links to `${apiUrl}/auth/<provider>`; the demo shows the URL instead of navigating.
  const intercept = (event: MouseEvent<HTMLDivElement>) => {
    const anchor = (event.target as HTMLElement).closest("a");
    if (!anchor) return;
    event.preventDefault();
    setLog((l) => [...l, `→ ${anchor.getAttribute("href")}`]);
  };
  return (
    <DemoShell
      footer={
        <>
          Each button is a full-page link to the strategy's <code>/auth/&lt;provider&gt;</code> route; the provider
          redirects back to <code>redirectUrl</code> with tokens in the URL fragment, which <code>AuthProvider</code>{" "}
          consumes. Here, clicks are intercepted and the target URL is logged instead.
        </>
      }
    >
      <div onClickCapture={intercept}>
        <OAuthButtons apiUrl={DEMO_API} />
      </div>
      <DemoLog entries={log} />
    </DemoShell>
  );
}

function AuthProviderPanel() {
  const { status, user, login, logout } = useAuth();
  const [error, setError] = useState<string>();
  return (
    <div className="flex flex-col gap-4 text-sm">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="text-muted-foreground">status</dt>
        <dd>
          <code>{status}</code>
        </dd>
        <dt className="text-muted-foreground">user</dt>
        <dd>
          <code>{user === undefined ? "undefined" : JSON.stringify(user)}</code>
        </dd>
      </dl>
      <div className="flex gap-2">
        <Button
          isDisabled={status === "authenticated"}
          onPress={() => {
            setError(undefined);
            login({ email: DEMO_EMAIL, password: DEMO_PASSWORD }).catch((reason: Error) => setError(reason.message));
          }}
        >
          login()
        </Button>
        <Button variant="outline" isDisabled={status !== "authenticated"} onPress={() => void logout()}>
          logout()
        </Button>
      </div>
      {error && <p className="text-destructive">{error}</p>}
    </div>
  );
}

export function AuthProviderDemo() {
  return (
    <DemoShell
      footer={
        <>
          <code>useAuth()</code> state from the nearest <code>&lt;AuthProvider&gt;</code> — the same context the login,
          signup, and OAuth blocks read.
        </>
      }
    >
      <AuthProvider>
        <AuthProviderPanel />
      </AuthProvider>
    </DemoShell>
  );
}
