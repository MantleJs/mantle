import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { AuthResult } from "@mantlejs/client";
import { useMantleClient } from "@mantlejs/react";

export type AuthStatus = "loading" | "authenticated" | "unauthenticated";

export interface LocalCredentials {
  email: string;
  password: string;
}

export interface SignupData extends LocalCredentials {
  name?: string;
  [field: string]: unknown;
}

export interface AuthContextValue {
  /** `"loading"` until the persisted session check on mount resolves. */
  status: AuthStatus;
  /** The user returned by the last successful `login()`. `undefined` after a page reload — the client
   * persists tokens, not the user record; fetch it from your users service if you need it then. */
  user: unknown;
  /** Error message an OAuth provider redirected back with (`#error=…`), if any. */
  oauthError?: string;
  /** Local-strategy login via `client.authenticate({ strategy: "local", … })`. Rejects with a `MantleClientError`. */
  login: (credentials: LocalCredentials) => Promise<AuthResult>;
  /** Creates the user through the users service, then logs in with the same credentials. */
  signup: (data: SignupData) => Promise<AuthResult>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export interface AuthProviderProps {
  children: ReactNode;
  /** Service `signup()` creates users through. @default "users" */
  usersService?: string;
  /** Strategy name `login()` authenticates with. @default "local" */
  strategy?: string;
  /**
   * Consume an `@mantlejs/auth-oauth` redirect on mount: tokens (`#accessToken=…&refreshToken=…`) or a
   * failure (`#error=…`) in the URL fragment, which is then stripped. @default true
   */
  handleOAuthRedirect?: boolean;
}

/**
 * Session state for the Mantle auth blocks. Must sit inside `@mantlejs/react`'s `<MantleProvider>` —
 * it talks to the server through that provider's client.
 */
export function AuthProvider({
  children,
  usersService = "users",
  strategy = "local",
  handleOAuthRedirect = true,
}: AuthProviderProps) {
  const client = useMantleClient();
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<unknown>(undefined);
  const [oauthError, setOauthError] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    const onAuthenticated = () => setStatus("authenticated");
    const onLogout = () => {
      setStatus("unauthenticated");
      setUser(undefined);
    };
    client.on("authenticated", onAuthenticated);
    client.on("logout", onLogout);

    const redirect = handleOAuthRedirect ? readOAuthFragment() : undefined;
    if (redirect?.error) setOauthError(redirect.error);
    if (redirect?.accessToken) {
      void client.setTokens({ accessToken: redirect.accessToken, refreshToken: redirect.refreshToken });
    } else {
      // isAuthenticated() hydrates the token from storage first — getAccessToken() alone would
      // report "logged out" on every page load even with a persisted session.
      void client.isAuthenticated().then((authenticated) => {
        if (!cancelled) setStatus(authenticated ? "authenticated" : "unauthenticated");
      });
    }
    return () => {
      cancelled = true;
      client.off("authenticated", onAuthenticated);
      client.off("logout", onLogout);
    };
  }, [client, handleOAuthRedirect]);

  const login = useCallback(
    async ({ email, password }: LocalCredentials) => {
      const result = await client.authenticate({ strategy, email, password });
      setUser(result.user);
      return result;
    },
    [client, strategy],
  );

  const signup = useCallback(
    async (data: SignupData) => {
      await client.service(usersService).create(data);
      return login({ email: data.email, password: data.password });
    },
    [client, usersService, login],
  );

  const logout = useCallback(() => client.logout(), [client]);

  const value = useMemo(
    () => ({ status, user, oauthError, login, signup, logout }),
    [status, user, oauthError, login, signup, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Session state and actions from the nearest `<AuthProvider>`. */
export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth() must be used within an <AuthProvider> (itself inside <MantleProvider>)");
  return value;
}

function readOAuthFragment(): { accessToken?: string; refreshToken?: string; error?: string } | undefined {
  if (typeof window === "undefined" || !window.location.hash) return undefined;
  const params = new URLSearchParams(window.location.hash.slice(1));
  const accessToken = params.get("accessToken") ?? undefined;
  const error = params.get("error") ?? undefined;
  if (!accessToken && !error) return undefined;
  // Tokens must not linger in the address bar, history, or a bookmarked URL.
  window.history.replaceState(null, "", window.location.pathname + window.location.search);
  return { accessToken, refreshToken: params.get("refreshToken") ?? undefined, error };
}
