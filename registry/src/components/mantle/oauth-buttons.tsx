import { cn } from "cn";
import { LinkButton } from "@/components/ui/button";

/** Provider keys registered by the `@mantlejs/auth-*` strategy packages (`GET /auth/{key}`). */
export type OAuthProviderKey = "google" | "github" | "facebook" | "apple" | "microsoft" | "linkedin" | "twitter";

/**
 * Display names, written the way each provider's own sign-in guidelines name the product. `twitter` is
 * the `@mantlejs/auth-twitter` route key; the user-facing name is "X".
 */
export const OAUTH_PROVIDER_LABELS: Record<OAuthProviderKey, string> = {
  google: "Google",
  github: "GitHub",
  facebook: "Facebook",
  apple: "Apple",
  microsoft: "Microsoft",
  linkedin: "LinkedIn",
  twitter: "X",
};

export interface OAuthButtonsProps {
  /** Base URL of the Mantle API, e.g. `"http://localhost:3030"` — the same `url` given to `mantle()`. */
  apiUrl: string;
  /** Providers to show, in order. Only list strategies actually configured server-side. @default all seven */
  providers?: OAuthProviderKey[];
  /** Per-provider route overrides, relative to `apiUrl`. @default `/auth/{key}` */
  paths?: Partial<Record<OAuthProviderKey, string>>;
  /** Button text. @default `Continue with ${name}` */
  label?: (name: string, key: OAuthProviderKey) => string;
  className?: string;
}

const ALL_PROVIDERS = Object.keys(OAUTH_PROVIDER_LABELS) as OAuthProviderKey[];

/**
 * One full-page-navigation link per `@mantlejs/auth-oauth` strategy (the consent flow leaves your app,
 * so this is an `<a href>`, never a `fetch`). Configure the strategy's `redirectUrl` to point back at the
 * page rendering `<AuthProvider>`, which picks the tokens up from the URL fragment.
 *
 * Text-only by design: no provider logos are bundled. Each provider licenses its mark under its own
 * brand guidelines — add official assets yourself if you want them.
 */
export function OAuthButtons({ apiUrl, providers = ALL_PROVIDERS, paths = {}, label, className }: OAuthButtonsProps) {
  const base = apiUrl.replace(/\/+$/, "");
  return (
    <div role="group" aria-label="Sign in with another provider" className={cn("flex flex-col gap-2", className)}>
      {providers.map((key) => {
        const name = OAUTH_PROVIDER_LABELS[key];
        return (
          <LinkButton key={key} variant="outline" href={`${base}${paths[key] ?? `/auth/${key}`}`}>
            {label ? label(name, key) : `Continue with ${name}`}
          </LinkButton>
        );
      })}
    </div>
  );
}
