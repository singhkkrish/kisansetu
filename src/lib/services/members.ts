import type { SupabaseClient } from "@supabase/supabase-js";
import type { MemberFilters } from "@/lib/services/member-filters";
import { maskAccountNumber } from "@/lib/validation/bank";
import type { Crop } from "@/types/domain";

export const MEMBER_PAGE_SIZE = 25;

export interface MemberListItem {
  id: string;
  memberCode: string;
  fullName: string;
  village: string;
  centreId: string | null;
  centreCode: string | null;
  centreName: string | null;
  landAcres: number;
  crops: Crop[];
  active: boolean;
  /** Safe for every role: only the status, never the bank details. */
  bankVerified: boolean;
}

export interface MemberDetail extends MemberListItem {
  phone: string | null;
  consentRecordedAt: string | null;
  createdAt: string;
}

/** The only shape in which bank details ever leave the server. */
export interface MaskedBank {
  holderName: string;
  accountMasked: string;
  ifsc: string;
  verified: boolean;
  verifiedAt: string | null;
}

export interface CentreOption {
  id: string;
  code: string;
  name: string;
}

export interface PurchaseSummary {
  slipNo: string;
  recordedAt: string;
  crop: Crop;
  netKg: number;
  amount: number;
  approvalStatus: string;
  paymentStatus: string;
}

const LIST_COLUMNS =
  "id, member_code, full_name, village, centre_id, land_acres, crops, active, bank_verified, centres(code, name)";
const DETAIL_COLUMNS = `${LIST_COLUMNS}, phone, consent_recorded_at, created_at`;

type Row = Record<string, unknown>;

function mapMember(row: Row): MemberDetail {
  const embedded = Array.isArray(row.centres) ? row.centres[0] : row.centres;
  const centre = (embedded ?? null) as { code: string; name: string } | null;
  return {
    id: row.id as string,
    memberCode: row.member_code as string,
    fullName: row.full_name as string,
    village: row.village as string,
    centreId: (row.centre_id as string | null) ?? null,
    centreCode: centre?.code ?? null,
    centreName: centre?.name ?? null,
    landAcres: Number(row.land_acres),
    crops: (row.crops as Crop[] | null) ?? [],
    active: row.active as boolean,
    bankVerified: row.bank_verified === true,
    phone: (row.phone as string | null) ?? null,
    consentRecordedAt: (row.consent_recorded_at as string | null) ?? null,
    createdAt: (row.created_at as string | undefined) ?? "",
  };
}

export interface MemberSearchResult {
  rows: MemberListItem[];
  total: number;
  failed: boolean;
}

export async function searchMembers(
  supabase: SupabaseClient,
  filters: MemberFilters,
): Promise<MemberSearchResult> {
  const from = (filters.page - 1) * MEMBER_PAGE_SIZE;

  let query = supabase
    .from("farmer_members")
    .select(LIST_COLUMNS, { count: "exact" })
    .order("full_name")
    .order("member_code")
    .range(from, from + MEMBER_PAGE_SIZE - 1);

  if (filters.status !== "all") query = query.eq("active", filters.status === "active");
  if (filters.village) query = query.eq("village", filters.village);
  if (filters.centreId) query = query.eq("centre_id", filters.centreId);
  // Farmer ID or name. `filters.q` has already been cleaned of filter syntax.
  if (filters.q) query = query.or(`full_name.ilike.%${filters.q}%,member_code.ilike.%${filters.q}%`);

  const { data, count, error } = await query;
  if (error || !data) return { rows: [], total: 0, failed: true };
  return { rows: (data as Row[]).map(mapMember), total: count ?? data.length, failed: false };
}

export async function getMember(supabase: SupabaseClient, id: string): Promise<MemberDetail | null> {
  const { data, error } = await supabase
    .from("farmer_members")
    .select(DETAIL_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? mapMember(data as Row) : null;
}

/**
 * Reads bank details and masks the number before returning. Callers must have
 * checked `members:bank:read`; row level security refuses anyone else anyway.
 */
export async function getMaskedBank(supabase: SupabaseClient, memberId: string): Promise<MaskedBank | null> {
  const { data, error } = await supabase
    .from("farmer_bank_accounts")
    .select("holder_name, account_number, ifsc, verified, verified_at")
    .eq("member_id", memberId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    holderName: data.holder_name,
    accountMasked: maskAccountNumber(data.account_number),
    ifsc: data.ifsc,
    verified: data.verified === true,
    verifiedAt: data.verified_at ?? null,
  };
}

export async function listCentres(supabase: SupabaseClient): Promise<CentreOption[]> {
  const { data } = await supabase
    .from("centres")
    .select("id, code, name")
    .eq("active", true)
    .order("code");
  return (data as CentreOption[] | null) ?? [];
}

export async function listVillages(supabase: SupabaseClient): Promise<string[]> {
  const { data } = await supabase.from("farmer_villages").select("village").order("village");
  return ((data as { village: string }[] | null) ?? []).map((row) => row.village);
}

/** Latest purchases for one farmer. Row level security keeps operators to their own centre. */
export async function listRecentPurchases(
  supabase: SupabaseClient,
  farmerId: string,
  limit = 5,
): Promise<PurchaseSummary[]> {
  const { data } = await supabase
    .from("procurement_entries")
    .select("slip_no, device_recorded_at, crop, net_kg, amount, approval_status, payment_status")
    .eq("farmer_id", farmerId)
    .order("device_recorded_at", { ascending: false })
    .limit(limit);

  return ((data as Row[] | null) ?? []).map((row) => ({
    slipNo: row.slip_no as string,
    recordedAt: row.device_recorded_at as string,
    crop: row.crop as Crop,
    netKg: Number(row.net_kg),
    amount: Number(row.amount),
    approvalStatus: row.approval_status as string,
    paymentStatus: row.payment_status as string,
  }));
}
