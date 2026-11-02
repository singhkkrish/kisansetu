import type { SupabaseClient } from "@supabase/supabase-js";

export interface OperatorContext {
  operatorId: string;
  centreId: string;
  centreCode: string;
}

export type OperatorLookup =
  | { ok: true; operator: OperatorContext }
  | { ok: false; status: 401 | 403; error: string };

/** Resolves the signed-in user to a centre operator, for the sync endpoints. */
export async function requireOperator(supabase: SupabaseClient): Promise<OperatorLookup> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, status: 401, error: "unauthorised" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, centre_id, active, centres(code)")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile?.active || profile.role !== "centre_operator" || !profile.centre_id) {
    return { ok: false, status: 403, error: "only centre operators can use this endpoint" };
  }

  const centre = Array.isArray(profile.centres) ? profile.centres[0] : profile.centres;
  if (!centre?.code) return { ok: false, status: 403, error: "operator has no centre" };

  return {
    ok: true,
    operator: { operatorId: user.id, centreId: profile.centre_id, centreCode: centre.code },
  };
}
