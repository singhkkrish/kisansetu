import { connection } from "next/server";
import { cache } from "react";
import { isRole } from "@/lib/auth/permissions";
import { readSupabaseEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/types/domain";

export interface SessionInfo {
  userId: string;
  email: string | null;
  profile: Profile;
  centre: { id: string; code: string; name: string } | null;
}

export type AuthState =
  | { status: "signed_out" }
  /** Signed in with Supabase Auth but no active staff profile (never set up, or deactivated). */
  | { status: "no_profile"; email: string | null }
  | { status: "ready"; session: SessionInfo };

/** Who is making this request, validated with Supabase Auth. Cached per request. */
export const getAuthState = cache(async (): Promise<AuthState> => {
  // Unconfigured app: treat as signed out so the login page can show setup help.
  if (!readSupabaseEnv()) {
    await connection();
    return { status: "signed_out" };
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "signed_out" };

  const { data: row } = await supabase
    .from("profiles")
    .select("id, full_name, role, centre_id, preferred_lang, active, centres(id, code, name)")
    .eq("id", user.id)
    .maybeSingle();

  if (!row || !row.active || !isRole(row.role)) {
    return { status: "no_profile", email: user.email ?? null };
  }

  const embedded = Array.isArray(row.centres) ? row.centres[0] : row.centres;

  return {
    status: "ready",
    session: {
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
    },
  };
});

/** Signed-in user with their staff profile, or null. */
export async function getSession(): Promise<SessionInfo | null> {
  const state = await getAuthState();
  return state.status === "ready" ? state.session : null;
}
