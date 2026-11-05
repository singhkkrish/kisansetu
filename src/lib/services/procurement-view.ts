import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApprovalStatus, Crop, FlagReason, Grade, PaymentStatus } from "@/types/domain";

export interface EntryListItem {
  id: string;
  slipNo: string;
  farmerName: string;
  farmerCode: string;
  centreCode: string;
  centreName: string;
  crop: Crop;
  netKg: string;
  amount: string;
  approvalStatus: ApprovalStatus;
  paymentStatus: PaymentStatus;
  syncStatus: "pending" | "synced" | "rejected";
  /** Why the entry needs a look. Empty means no anomaly was found. */
  flagReasons: FlagReason[];
  flagCount: number;
  receivedAt: string;
}

type Raw = Record<string, unknown>;
const one = <T,>(v: unknown): T | null => (Array.isArray(v) ? ((v[0] as T) ?? null) : ((v as T) ?? null));

export const APPROVAL_FILTERS = ["all", "held", "approved", "rejected"] as const;
export type ApprovalFilter = (typeof APPROVAL_FILTERS)[number];

export function parseApprovalFilter(value: unknown): ApprovalFilter {
  return (APPROVAL_FILTERS as readonly string[]).includes(String(value)) ? (value as ApprovalFilter) : "all";
}

export const LIST_LIMIT = 100;

export interface ListOptions {
  centreId?: string | null;
  /** Only entries the server flagged as anomalies. */
  anomaliesOnly?: boolean;
}

export async function listEntries(
  supabase: SupabaseClient,
  filter: ApprovalFilter,
  options: ListOptions = {},
): Promise<{ items: EntryListItem[]; error: boolean }> {
  let query = supabase
    .from("procurement_entries")
    .select(
      "id, slip_no, crop, net_kg, amount, approval_status, payment_status, sync_status, flag_reasons, server_received_at, farmer_members(full_name, member_code), centres(code, name)",
    )
    .order("server_received_at", { ascending: false })
    .limit(LIST_LIMIT);
  if (filter !== "all") query = query.eq("approval_status", filter);
  if (options.centreId) query = query.eq("centre_id", options.centreId);
  if (options.anomaliesOnly) query = query.not("flag_reasons", "eq", "{}");

  const { data, error } = await query;
  if (error) return { items: [], error: true };

  return {
    error: false,
    items: ((data as Raw[] | null) ?? []).map((r) => {
      const farmer = one<{ full_name: string; member_code: string }>(r.farmer_members);
      const centre = one<{ code: string; name: string }>(r.centres);
      const flags = ((r.flag_reasons as string[] | null) ?? []) as FlagReason[];
      return {
        id: r.id as string,
        slipNo: r.slip_no as string,
        farmerName: farmer?.full_name ?? "—",
        farmerCode: farmer?.member_code ?? "",
        centreCode: centre?.code ?? "",
        centreName: centre?.name ?? "",
        crop: r.crop as Crop,
        netKg: Number(r.net_kg).toFixed(1),
        amount: Number(r.amount).toFixed(2),
        approvalStatus: r.approval_status as ApprovalStatus,
        paymentStatus: r.payment_status as PaymentStatus,
        syncStatus: r.sync_status as "pending" | "synced" | "rejected",
        flagReasons: flags,
        flagCount: flags.length,
        receivedAt: r.server_received_at as string,
      };
    }),
  };
}

export interface AuditItem {
  id: string;
  action: string;
  at: string;
  actorName: string | null;
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
}

export interface EntryDetail {
  id: string;
  clientId: string;
  slipNo: string;
  farmerName: string;
  farmerCode: string;
  village: string;
  centreCode: string;
  centreName: string;
  operatorName: string | null;
  crop: Crop;
  grade: Grade;
  grossKg: string;
  tareKg: string;
  moisturePct: string;
  netKg: string;
  ratePerQuintal: string;
  amount: string;
  rateDate: string | null;
  rateVersion: number | null;
  deviceRecordedAt: string;
  serverReceivedAt: string;
  clockOffsetMs: number | null;
  approvalStatus: ApprovalStatus;
  paymentStatus: PaymentStatus;
  flagReasons: FlagReason[];
  reviewNote: string | null;
  audit: AuditItem[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Finds an entry by its database id or by the phone's idempotency key. */
export async function getEntryDetail(supabase: SupabaseClient, idOrClientId: string): Promise<EntryDetail | null> {
  if (!UUID.test(idOrClientId)) return null;
  const { data } = await supabase
    .from("procurement_entries")
    .select(
      "*, farmer_members(full_name, member_code, village), centres(code, name), profiles!procurement_entries_operator_id_fkey(full_name)",
    )
    .or(`id.eq.${idOrClientId},client_id.eq.${idOrClientId}`)
    .maybeSingle();
  if (!data) return null;
  const r = data as Raw;

  const { data: logs } = await supabase
    .from("procurement_audit_logs")
    .select("id, action, created_at, actor_id, old_values, new_values")
    .eq("entry_id", r.id as string)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  const actorIds = [...new Set(((logs as Raw[] | null) ?? []).map((l) => l.actor_id as string | null).filter(Boolean))] as string[];
  const names = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data: people } = await supabase.from("profiles").select("id, full_name").in("id", actorIds);
    for (const p of (people as Raw[] | null) ?? []) names.set(p.id as string, p.full_name as string);
  }

  const farmer = one<{ full_name: string; member_code: string; village: string }>(r.farmer_members);
  const centre = one<{ code: string; name: string }>(r.centres);
  const operator = one<{ full_name: string }>(r.profiles);

  return {
    id: r.id as string,
    clientId: r.client_id as string,
    slipNo: r.slip_no as string,
    farmerName: farmer?.full_name ?? "—",
    farmerCode: farmer?.member_code ?? "",
    village: farmer?.village ?? "",
    centreCode: centre?.code ?? "",
    centreName: centre?.name ?? "",
    operatorName: operator?.full_name ?? null,
    crop: r.crop as Crop,
    grade: r.grade as Grade,
    grossKg: Number(r.gross_kg).toFixed(1),
    tareKg: Number(r.tare_kg).toFixed(1),
    moisturePct: Number(r.moisture_pct).toFixed(1),
    netKg: Number(r.net_kg).toFixed(1),
    ratePerQuintal: Number(r.rate_per_quintal).toFixed(2),
    amount: Number(r.amount).toFixed(2),
    rateDate: (r.rate_price_date as string | null) ?? null,
    rateVersion: (r.rate_version as number | null) ?? null,
    deviceRecordedAt: r.device_recorded_at as string,
    serverReceivedAt: r.server_received_at as string,
    clockOffsetMs: (r.device_clock_offset_ms as number | null) ?? null,
    approvalStatus: r.approval_status as ApprovalStatus,
    paymentStatus: r.payment_status as PaymentStatus,
    flagReasons: ((r.flag_reasons as string[] | null) ?? []) as FlagReason[],
    reviewNote: (r.review_note as string | null) ?? null,
    audit: ((logs as Raw[] | null) ?? []).map((l) => ({
      id: l.id as string,
      action: l.action as string,
      at: l.created_at as string,
      actorName: l.actor_id ? (names.get(l.actor_id as string) ?? null) : null,
      oldValues: (l.old_values as Record<string, unknown> | null) ?? null,
      newValues: (l.new_values as Record<string, unknown> | null) ?? null,
    })),
  };
}
