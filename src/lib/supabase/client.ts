import { createBrowserClient } from "@supabase/ssr";

// NEXT_PUBLIC_ variables must be referenced literally so Next can inline them.
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("Supabase is not configured.");
  }
  return createBrowserClient(url, anonKey);
}
