import { connection } from "next/server";
import { cache } from "react";
import { readSupabaseEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/types/domain";

export interface SessionInfo {
  userId: string;
  email: string | null;
  profile: Profile;
  centre: { id: string; code: string; name: string } | null;
}

/** Signed-in user with their staff profile, or null. Cached per request. */
export const getSession = cache(async (): Promise<SessionInfo | null> => {
  // Unconfigured app: treat as signed out so the login page can show setup help.
  if (!readSupabaseEnv()) {
    await connection();
    return null;
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: row } = await supabase
    .from("profiles")
    .select("id, full_name, role, centre_id, preferred_lang, active, centres(id, code, name)")
    .eq("id", user.id)
    .maybeSingle();

  if (!row || !row.active) return null;

  const embedded = Array.isArray(row.centres) ? row.centres[0] : row.centres;

  return {
    userId: user.id,
    email: user.email ?? null,
    profile: {
      id: row.id,
      full_name: row.full_name,
      role: row.role,
      centre_id: row.centre_id,
      preferred_lang: row.preferred_lang,
    },
    centre: embedded ? { id: embedded.id, code: embedded.code, name: embedded.name } : null,
  };
});
