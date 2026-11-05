import type { SupabaseClient } from "@supabase/supabase-js";
import { groupByFarmer, type PayableEntry, type PaymentPreview } from "@/lib/payments/grouping";
import type { BankFileRow } from "@/lib/payments/bank-file";
import { maskAccountNumber } from "@/lib/validation/bank";

type Raw = Record<string, unknown>;
const one = <T,>(v: unknown): T | null => (Array.isArray(v) ? ((v[0] as T) ?? null) : ((v as T) ?? null));

export const PREVIEW_LIMIT = 5000;

/** First instant of an Indian calendar day, as an ISO string with the IST offset. */
const istStart = (date: string) => `${date}T00:00:00+05:30`;
function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export interface PreviewResult {
  preview: PaymentPreview;
  truncated: boolean;
  error: boolean;
}

/**
 * Approved, unpaid purchases for the chosen dates and centres, grouped by farmer.
 * This is a read for the manager to review. Generating the run re-selects
 * everything inside the database, so a stale preview can never pay the wrong amount.
 */
export async function previewPayment(
  supabase: SupabaseClient,
  range: { from: string; to: string; centreIds: string[] },
): Promise<PreviewResult> {
  const empty = groupByFarmer([]);
  if (range.centreIds.length === 0) return { preview: empty, truncated: false, error: false };

  const { data, error } = await supabase
    .from("procurement_entries")
    .select(
      "id, slip_no, amount, farmer_id, centre_id, farmer_members(member_code, full_name, farmer_bank_accounts(holder_name, account_number, ifsc, verified))",
    )
    .eq("approval_status", "approved")
    .eq("payment_status", "unpaid")
    .eq("sync_status", "synced")
    .in("centre_id", range.centreIds)
    .gte("device_recorded_at", istStart(range.from))
    .lt("device_recorded_at", istStart(nextDay(range.to)))
    .order("slip_no")
    .limit(PREVIEW_LIMIT);
  if (error) return { preview: empty, truncated: false, error: true };

  const rows = (data as unknown as Raw[] | null) ?? [];
  const entries: PayableEntry[] = rows.map((r) => {
    const m = one<Raw>(r.farmer_members);
    const b = one<Raw>(m?.farmer_bank_accounts);
    return {
      id: r.id as string,
      slipNo: r.slip_no as string,
      farmerId: r.farmer_id as string,
      farmerCode: (m?.member_code as string) ?? "",
      farmerName: (m?.full_name as string) ?? "—",
      centreId: r.centre_id as string,
      amount: Number(r.amount).toFixed(2),
      bank: b
        ? {
            holderName: b.holder_name as string,
            accountNumber: b.account_number as string,
            ifsc: b.ifsc as string,
            verified: b.verified === true,
          }
        : null,
    };
  });
  return { preview: groupByFarmer(entries), truncated: rows.length >= PREVIEW_LIMIT, error: false };
}

export type RunStatus = "draft" | "approved" | "file_generated" | "completed" | "cancelled";
export type ItemStatus = "pending" | "processing" | "paid" | "failed";

export interface RunSummary {
  id: string;
  runNo: string;
  status: RunStatus;
  dateFrom: string;
  dateTo: string;
  itemCount: number;
  entryCount: number;
  totalAmount: string;
  createdAt: string;
  createdByName: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  bankFileName: string | null;
  fileGeneratedAt: string | null;
  cancelledReason: string | null;
  /** Items that failed and have not been returned to unpaid. */
  failedOpen: number;
}

export interface RunItem {
  id: string;
  farmerCode: string;
  farmerName: string;
  beneficiaryName: string;
  accountMasked: string;
  ifsc: string;
  entryCount: number;
  amount: string;
  paymentRef: string;
  status: ItemStatus;
  bankReference: string | null;
  failureReason: string | null;
  settledAt: string | null;
  released: boolean;
}

export interface RunAuditItem {
  id: string;
  action: string;
  at: string;
  actorName: string | null;
  details: Record<string, unknown>;
}

const RUN_SELECT =
  "id, run_no, status, date_from, date_to, item_count, entry_count, total_amount, created_at, approved_at, bank_file_name, file_generated_at, cancelled_reason, " +
  "creator:profiles!payment_runs_created_by_fkey(full_name), approver:profiles!payment_runs_approved_by_fkey(full_name), payment_items(status, released_at)";

function toRun(r: Raw): RunSummary {
  const items = ((r.payment_items as Raw[] | null) ?? []);
  return {
    id: r.id as string,
    runNo: r.run_no as string,
    status: r.status as RunStatus,
    dateFrom: r.date_from as string,
    dateTo: r.date_to as string,
    itemCount: Number(r.item_count),
    entryCount: Number(r.entry_count),
    totalAmount: Number(r.total_amount).toFixed(2),
    createdAt: r.created_at as string,
    createdByName: one<{ full_name: string }>(r.creator)?.full_name ?? null,
    approvedByName: one<{ full_name: string }>(r.approver)?.full_name ?? null,
    approvedAt: (r.approved_at as string | null) ?? null,
    bankFileName: (r.bank_file_name as string | null) ?? null,
    fileGeneratedAt: (r.file_generated_at as string | null) ?? null,
    cancelledReason: (r.cancelled_reason as string | null) ?? null,
    failedOpen: items.filter((i) => i.status === "failed" && !i.released_at).length,
  };
}

export const RUN_LIST_LIMIT = 100;

export async function listRuns(supabase: SupabaseClient): Promise<{ items: RunSummary[]; error: boolean }> {
  const { data, error } = await supabase
    .from("payment_runs")
    .select(RUN_SELECT)
    .order("created_at", { ascending: false })
    .limit(RUN_LIST_LIMIT);
  if (error) return { items: [], error: true };
  return { items: ((data as unknown as Raw[] | null) ?? []).map(toRun), error: false };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RunDetail {
  run: RunSummary;
  centreNames: string[];
  items: RunItem[];
  audit: RunAuditItem[];
}

/** A run with its items. Account numbers are masked here, before anything reaches a page. */
export async function getRun(supabase: SupabaseClient, id: string): Promise<RunDetail | null> {
  if (!UUID.test(id)) return null;
  const { data } = await supabase.from("payment_runs").select(`${RUN_SELECT}, centre_ids`).eq("id", id).maybeSingle();
  if (!data) return null;
  const raw = data as unknown as Raw;

  const [{ data: items }, { data: logs }, { data: centres }] = await Promise.all([
    supabase
      .from("payment_items")
      .select("id, farmer_code, farmer_name, beneficiary_name, account_number, ifsc, entry_count, amount, payment_ref, status, bank_reference, failure_reason, settled_at, released_at")
      .eq("run_id", id)
      .order("payment_ref"),
    supabase
      .from("payment_audit_logs")
      .select("id, action, created_at, details, actor:profiles!payment_audit_logs_actor_id_fkey(full_name)")
      .eq("run_id", id)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }),
    supabase.from("centres").select("id, code, name").in("id", (raw.centre_ids as string[]) ?? []),
  ]);

  return {
    run: toRun(raw),
    centreNames: ((centres as Raw[] | null) ?? []).map((c) => `${c.code} · ${c.name}`),
    items: ((items as Raw[] | null) ?? []).map((i) => ({
      id: i.id as string,
      farmerCode: i.farmer_code as string,
      farmerName: i.farmer_name as string,
      beneficiaryName: i.beneficiary_name as string,
      accountMasked: maskAccountNumber(i.account_number as string),
      ifsc: i.ifsc as string,
      entryCount: Number(i.entry_count),
      amount: Number(i.amount).toFixed(2),
      paymentRef: i.payment_ref as string,
      status: i.status as ItemStatus,
      bankReference: (i.bank_reference as string | null) ?? null,
      failureReason: (i.failure_reason as string | null) ?? null,
      settledAt: (i.settled_at as string | null) ?? null,
      released: Boolean(i.released_at),
    })),
    audit: ((logs as unknown as Raw[] | null) ?? []).map((l) => ({
      id: l.id as string,
      action: l.action as string,
      at: l.created_at as string,
      actorName: one<{ full_name: string }>(l.actor)?.full_name ?? null,
      details: (l.details as Record<string, unknown>) ?? {},
    })),
  };
}

/** Full bank details for the file. Server only: this is the one place account numbers are read in full. */
export async function getBankFileRows(
  supabase: SupabaseClient,
  runId: string,
): Promise<{ rows: BankFileRow[]; fileName: string; error: boolean }> {
  const { data: run } = await supabase.from("payment_runs").select("run_no, bank_file_name").eq("id", runId).maybeSingle();
  const { data, error } = await supabase
    .from("payment_items")
    .select("farmer_code, beneficiary_name, account_number, ifsc, amount, payment_ref")
    .eq("run_id", runId);
  if (error || !run) return { rows: [], fileName: "", error: true };
  const runNo = (run as Raw).run_no as string;
  return {
    fileName: ((run as Raw).bank_file_name as string | null) ?? `KISANSETU-MOCK-${runNo}.csv`,
    error: false,
    rows: ((data as Raw[] | null) ?? []).map((i) => ({
      beneficiaryName: i.beneficiary_name as string,
      accountNumber: i.account_number as string,
      ifsc: i.ifsc as string,
      amount: Number(i.amount).toFixed(2),
      paymentRef: i.payment_ref as string,
      runNo,
      farmerCode: i.farmer_code as string,
    })),
  };
}
