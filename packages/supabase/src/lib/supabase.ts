import { createClient, type SupabaseClientOptions } from "@supabase/supabase-js";
import type { MantleApplication, MantlePlugin } from "@mantlejs/mantle";

export interface SupabaseConfig {
  /** Supabase project URL (e.g. "https://xyzcompany.supabase.co"). */
  url: string;
  /** Supabase `anon` or `service_role` API key. */
  key: string;
  /** Additional Supabase client options. */
  options?: SupabaseClientOptions<string>;
}

/**
 * Mantle plugin that creates a Supabase client and stores it on the application.
 *
 * @example
 * ```ts
 * const app = mantle().configure(supabase({
 *   url: process.env.SUPABASE_URL!,
 *   key: process.env.SUPABASE_KEY!,
 * }));
 * ```
 */
export function supabase(config: SupabaseConfig): MantlePlugin {
  return (app: MantleApplication): void => {
    const client = createClient(config.url, config.key, config.options);
    app.set("supabase", client);
  };
}
