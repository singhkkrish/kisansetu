import type { SupabaseClient } from "@supabase/supabase-js";

export const ANOMALY_STATUSES = ["open", "reviewed", "confirmed", "false_positive"] as const;
export type AnomalyStatus = (typeof ANOMALY_STATUSES)[number];
export const ANOMALY_LIST_LIMIT = 200;

export interface AnomalyItem {
  id: string;
  entryId: string;
  rule: string;
  status: AnomalyStatus;
  details: Record<string, unknown>;
  raisedAt: string;
  reviewedAt: string | null;
  reviewedByName: string | null;
  reviewNote: string | null;
  slipNo: string;
  farmerName: string;
  farmerCode: string;
  centreCode: string;
  centreName: string;
  grossKg: string;
  netKg: string;
  moisturePct: string;
  amount: string;
  approvalStatus: string;
  paymentStatus: string;
}

type Raw = Record<string, unknown>;
const one = <T>(v: unknown): T | null => (Array.isArray(v) ? ((v[0] as T) ?? null) : ((v as T) ?? null));

const SELECT =
  "id, entry_id, rule, status, details, created_at, reviewed_at, review_note, reviewer:profiles!anomaly_flags_reviewed_by_fkey(full_name), procurement_entries!inner(slip_no, gross_kg, net_kg, moisture_pct, amount, approval_status, payment_status, farmer_members(full_name, member_code), centres(code, name))";

function toItem(r: Raw): AnomalyItem {
  const e = one<Raw>(r.procurement_entries);
  const farmer = one<Raw>(e?.farmer_members);
  const centre = one<Raw>(e?.centres);
  const reviewer = one<Raw>(r.reviewer);
  return {
    id: r.id as string,
    entryId: r.entry_id as string,
    rule: r.rule as string,
    status: r.status as AnomalyStatus,
    details: (r.details as Record<string, unknown>) ?? {},
    raisedAt: r.created_at as string,
    reviewedAt: (r.reviewed_at as string | null) ?? null,
    reviewedByName: (reviewer?.full_name as string | undefined) ?? null,
    reviewNote: (r.review_note as string | null) ?? null,
    slipNo: (e?.slip_no as string) ?? "",
    farmerName: (farmer?.full_name as string) ?? "—",
    farmerCode: (farmer?.member_code as string) ?? "",
    centreCode: (centre?.code as string) ?? "",
    centreName: (centre?.name as string) ?? "",
    grossKg: Number(e?.gross_kg ?? 0).toFixed(1),
    netKg: Number(e?.net_kg ?? 0).toFixed(1),
    moisturePct: Number(e?.moisture_pct ?? 0).toFixed(1),
    amount: Number(e?.amount ?? 0).toFixed(2),
    approvalStatus: (e?.approval_status as string) ?? "",
    paymentStatus: (e?.payment_status as string) ?? "",
  };
}

export function parseAnomalyStatus(value: unknown): AnomalyStatus | "all" {
  return typeof value === "string" && (ANOMALY_STATUSES as readonly string[]).includes(value) ? (value as AnomalyStatus) : "all";
}

export async function listAnomalies(
  supabase: SupabaseClient,
  status: AnomalyStatus | "all",
  centreId?: string | null,
): Promise<{ items: AnomalyItem[]; error: boolean }> {
  let query = supabase.from("anomaly_flags").select(SELECT).order("created_at", { ascending: false }).limit(ANOMALY_LIST_LIMIT);
  if (status !== "all") query = query.eq("status", status);
  if (centreId) query = query.eq("procurement_entries.centre_id", centreId);
  const { data, error } = await query;
  if (error) return { items: [], error: true };
  return { items: ((data as Raw[] | null) ?? []).map(toItem), error: false };
}

export async function listEntryAnomalies(supabase: SupabaseClient, entryId: string): Promise<AnomalyItem[]> {
  const { data } = await supabase.from("anomaly_flags").select(SELECT).eq("entry_id", entryId).order("created_at");
  return ((data as Raw[] | null) ?? []).map(toItem);
}

/** Entries from this list that still have an anomaly nobody has reviewed. Their payment stays on hold. */
export async function openAnomalyEntryIds(supabase: SupabaseClient, entryIds: string[]): Promise<Set<string>> {
  if (entryIds.length === 0) return new Set();
  const { data } = await supabase.from("anomaly_flags").select("entry_id").eq("status", "open").in("entry_id", entryIds);
  return new Set(((data as { entry_id: string }[] | null) ?? []).map((r) => r.entry_id));
}

export interface AnomalySetting {
  key: string;
  value: number;
  min: number;
  max: number;
  isAssumption: boolean;
  updatedAt: string | null;
}

export async function listAnomalySettings(supabase: SupabaseClient): Promise<{ items: AnomalySetting[]; error: boolean }> {
  const { data, error } = await supabase.from("anomaly_settings").select("key, value, min_value, max_value, is_assumption, updated_at").order("key");
  if (error) return { items: [], error: true };
  return {
    error: false,
    items: ((data as Raw[] | null) ?? []).map((r) => ({
      key: r.key as string,
      value: Number(r.value),
      min: Number(r.min_value),
      max: Number(r.max_value),
      isAssumption: r.is_assumption === true,
      updatedAt: (r.updated_at as string | null) ?? null,
    })),
  };
}
