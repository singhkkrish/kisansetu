import type { SupabaseClient } from "@supabase/supabase-js";
import { summariseStock, type StockRow, type StockSummary } from "@/lib/stock/stock";
import type { Crop } from "@/types/domain";

type Raw = Record<string, unknown>;
const one = <T,>(v: unknown): T | null => (Array.isArray(v) ? ((v[0] as T) ?? null) : ((v as T) ?? null));

export interface StockFilters {
  /** Stock is shown as at the end of this day (YYYY-MM-DD). */
  date: string;
  centreId: string | null;
  crop: Crop | null;
}

export interface StockView {
  summary: StockSummary;
  rows: StockRow[];
  unsynced: number;
}

export async function loadStock(supabase: SupabaseClient, f: StockFilters): Promise<{ view: StockView | null; error: boolean }> {
  const [stock, unsynced] = await Promise.all([
    supabase.rpc("stock_summary", { p_as_of: f.date, p_centre: f.centreId, p_crop: f.crop }),
    supabase.rpc("unsynced_records", { p_centre: f.centreId }),
  ]);
  if (stock.error || unsynced.error) return { view: null, error: true };

  const rows: StockRow[] = ((stock.data as Raw[] | null) ?? []).map((r) => ({
    centreId: r.centre_id as string,
    crop: r.crop as Crop,
    procuredKg: String(r.procured_kg),
    dayKg: String(r.day_kg),
    dispatchedBookKg: String(r.dispatched_book_kg),
    dispatchedWeightKg: String(r.dispatched_weight_kg),
    heldCount: Number(r.held_count),
    pendingPayCount: Number(r.pending_pay_count),
    pendingPayAmount: String(r.pending_pay_amount),
    failedCount: Number(r.failed_count),
    failedAmount: String(r.failed_amount),
  }));
  return { view: { summary: summariseStock(rows), rows, unsynced: Number(unsynced.data ?? 0) }, error: false };
}

export interface DispatchItem {
  id: string;
  dispatchNo: string;
  centreCode: string;
  centreName: string;
  crop: Crop;
  weightKg: string;
  bookKg: string;
  stockBeforeKg: string;
  stockAfterKg: string;
  destination: string;
  truckNo: string;
  dispatchedAt: string;
  recordedAt: string;
  createdByName: string | null;
}

export const DISPATCH_LIMIT = 100;

export async function listDispatches(
  supabase: SupabaseClient,
  f: { centreId: string | null; crop: Crop | null },
): Promise<{ items: DispatchItem[]; error: boolean }> {
  let query = supabase
    .from("stock_dispatches")
    .select(
      "id, dispatch_no, crop, weight_kg, book_kg, stock_before_kg, stock_after_kg, destination, truck_no, dispatched_at, recorded_at, centres(code, name), creator:profiles!stock_dispatches_created_by_fkey(full_name)",
    )
    .order("dispatched_at", { ascending: false })
    .limit(DISPATCH_LIMIT);
  if (f.centreId) query = query.eq("centre_id", f.centreId);
  if (f.crop) query = query.eq("crop", f.crop);
  const { data, error } = await query;
  if (error) return { items: [], error: true };
  return {
    error: false,
    items: ((data as unknown as Raw[] | null) ?? []).map((r) => {
      const c = one<{ code: string; name: string }>(r.centres);
      return {
        id: r.id as string,
        dispatchNo: r.dispatch_no as string,
        centreCode: c?.code ?? "",
        centreName: c?.name ?? "",
        crop: r.crop as Crop,
        weightKg: Number(r.weight_kg).toFixed(1),
        bookKg: Number(r.book_kg).toFixed(1),
        stockBeforeKg: Number(r.stock_before_kg).toFixed(1),
        stockAfterKg: Number(r.stock_after_kg).toFixed(1),
        destination: r.destination as string,
        truckNo: r.truck_no as string,
        dispatchedAt: r.dispatched_at as string,
        recordedAt: r.recorded_at as string,
        createdByName: one<{ full_name: string }>(r.creator)?.full_name ?? null,
      };
    }),
  };
}

/** Current stock for one centre and crop, for the dispatch form. */
export async function currentStock(supabase: SupabaseClient, f: { centreId: string; crop: Crop }): Promise<string | null> {
  const { data, error } = await supabase.rpc("stock_summary", { p_as_of: null, p_centre: f.centreId, p_crop: f.crop });
  if (error) return null;
  const rows = (data as Raw[] | null) ?? [];
  if (rows.length === 0) return "0.0";
  const r = rows[0];
  return (Number(r.procured_kg) - Number(r.dispatched_book_kg)).toFixed(1);
}
