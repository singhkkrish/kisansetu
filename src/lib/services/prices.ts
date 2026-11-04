import type { SupabaseClient } from "@supabase/supabase-js";
import type { PriceStatus, PriceVersion } from "@/lib/prices/price-board";
import type { Crop, Grade } from "@/types/domain";

type Raw = Record<string, unknown>;
const one = <T,>(v: unknown): T | null => (Array.isArray(v) ? ((v[0] as T) ?? null) : ((v as T) ?? null));

const SELECT =
  "id, price_date, crop, grade, version, rate_per_quintal, status, created_at, published_at, correction_reason, " +
  "creator:profiles!price_versions_created_by_fkey(full_name), publisher:profiles!price_versions_published_by_fkey(full_name)";

export function toPriceVersion(r: Raw): PriceVersion {
  return {
    id: r.id as string,
    priceDate: r.price_date as string,
    crop: r.crop as Crop,
    grade: r.grade as Grade,
    version: Number(r.version),
    rate: Number(r.rate_per_quintal).toFixed(2),
    status: r.status as PriceStatus,
    createdByName: one<{ full_name: string }>(r.creator)?.full_name ?? null,
    createdAt: r.created_at as string,
    publishedByName: one<{ full_name: string }>(r.publisher)?.full_name ?? null,
    publishedAt: (r.published_at as string | null) ?? null,
    correctionReason: (r.correction_reason as string | null) ?? null,
  };
}

export const HISTORY_LIMIT = 300;

export async function listPriceVersions(
  supabase: SupabaseClient,
  range: { from?: string; to?: string; crop?: Crop | "" },
): Promise<{ items: PriceVersion[]; error: boolean }> {
  let query = supabase
    .from("price_versions")
    .select(SELECT)
    .order("price_date", { ascending: false })
    .order("crop")
    .order("grade")
    .order("version", { ascending: false })
    .limit(HISTORY_LIMIT);
  if (range.from) query = query.gte("price_date", range.from);
  if (range.to) query = query.lte("price_date", range.to);
  if (range.crop) query = query.eq("crop", range.crop);

  const { data, error } = await query;
  if (error) return { items: [], error: true };
  return { items: ((data as unknown as Raw[] | null) ?? []).map(toPriceVersion), error: false };
}

export interface PriceAuditItem {
  id: string;
  versionId: string;
  action: string;
  at: string;
  actorName: string | null;
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
}

/** Audit rows for the given versions, oldest first. */
export async function listPriceAudit(
  supabase: SupabaseClient,
  versionIds: string[],
): Promise<PriceAuditItem[]> {
  if (versionIds.length === 0) return [];
  const { data } = await supabase
    .from("price_audit_logs")
    .select("id, price_version_id, action, created_at, old_values, new_values, actor:profiles(full_name)")
    .in("price_version_id", versionIds)
    .order("created_at", { ascending: true });
  return ((data as unknown as Raw[] | null) ?? []).map((r) => ({
    id: r.id as string,
    versionId: r.price_version_id as string,
    action: r.action as string,
    at: r.created_at as string,
    actorName: one<{ full_name: string }>(r.actor)?.full_name ?? null,
    oldValues: (r.old_values as Record<string, unknown> | null) ?? null,
    newValues: (r.new_values as Record<string, unknown> | null) ?? null,
  }));
}
