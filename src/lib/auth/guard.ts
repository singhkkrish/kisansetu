import type { SupabaseClient } from "@supabase/supabase-js";
import { can, isRole, type Permission } from "@/lib/auth/permissions";
import type { UserRole } from "@/types/domain";

export interface AuthorizedUser {
  userId: string;
  email: string | null;
  role: UserRole;
  centreId: string | null;
}

export type AuthResult =
  | { ok: true; user: AuthorizedUser }
  | { ok: false; status: 401 | 403; error: string };

/**
 * Server-side authorization for API routes.
 *
 * The user comes from `auth.getUser()`, which asks Supabase Auth to validate
 * the token, rather than trusting a cookie's contents. The role comes from the
 * database profile, never from anything the browser can edit.
 */
export async function authorize(supabase: SupabaseClient, permission: Permission): Promise<AuthResult> {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) return { ok: false, status: 401, error: "Sign in to continue" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, centre_id, active")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile || profile.active !== true || !isRole(profile.role)) {
    return { ok: false, status: 403, error: "Your account has no active staff profile" };
  }
  if (profile.role === "centre_operator" && !profile.centre_id) {
    return { ok: false, status: 403, error: "Your account is not assigned to a centre" };
  }
  if (!can(profile.role, permission)) {
    return { ok: false, status: 403, error: "You do not have permission to do this" };
  }

  return {
    ok: true,
    user: {
      userId: user.id,
      email: user.email ?? null,
      role: profile.role,
      centreId: profile.centre_id ?? null,
    },
  };
}
