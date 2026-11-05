import type { Metadata } from "next";
import Link from "next/link";
import { RunStatusBadge } from "@/components/payments/status-badges";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { requirePermission } from "@/lib/auth/page-guard";
import { formatDisplayDate, formatInr } from "@/lib/calculations/format";
import { getPart5Messages } from "@/lib/i18n/part5-messages";
import { listRuns } from "@/lib/services/payments";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Payment runs" };

export default async function PaymentRunsPage() {
  const session = await requirePermission("payment_runs:create");
  const t = getPart5Messages(session.profile.preferred_lang).payments;
  const { items, error } = await listRuns(await createClient());

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t.title}</h1>
          <p className="mt-1 text-sm text-muted">{t.intro}</p>
        </div>
        <Button asChild size="lg"><Link href="/payments/new" data-testid="new-run">{t.newRun}</Link></Button>
      </div>

      {error ? (
        <Notice tone="error">{t.loadError}</Notice>
      ) : items.length === 0 ? (
        <p className="text-muted">{t.empty}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full min-w-[48rem] text-left text-base" data-testid="runs-table">
            <thead className="border-b border-line text-sm text-muted">
              <tr>
                {[t.run, t.dates, t.farmers, t.entries, t.total, t.status, t.created].map((c) => (
                  <th key={c} scope="col" className="px-4 py-3 font-semibold">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {items.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-3 font-semibold"><Link href={`/payments/${r.id}`} className="text-primary underline">{r.runNo}</Link></td>
                  <td className="px-4 py-3 text-sm">{formatDisplayDate(`${r.dateFrom}T06:30:00Z`)}{r.dateTo !== r.dateFrom && ` – ${formatDisplayDate(`${r.dateTo}T06:30:00Z`)}`}</td>
                  <td className="px-4 py-3 tabular-nums">{r.itemCount}</td>
                  <td className="px-4 py-3 tabular-nums">{r.entryCount}</td>
                  <td className="px-4 py-3 font-bold tabular-nums">{formatInr(r.totalAmount)}</td>
                  <td className="px-4 py-3">
                    <RunStatusBadge status={r.status} labels={t.runStatus} />
                    {r.failedOpen > 0 && <span className="mt-1 block text-xs font-semibold text-danger">{r.failedOpen} {t.failedOpen}</span>}
                  </td>
                  <td className="px-4 py-3 text-sm">{formatDisplayDate(r.createdAt)}<span className="block text-xs text-muted">{r.createdByName ?? "—"}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
