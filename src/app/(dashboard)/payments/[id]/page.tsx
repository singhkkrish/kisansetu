import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BackLink } from "@/components/members/back-link";
import { RunControls } from "@/components/payments/run-controls";
import { RunItems } from "@/components/payments/run-items";
import { RunStatusBadge } from "@/components/payments/status-badges";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { requirePermission } from "@/lib/auth/page-guard";
import { formatDisplayDate, formatInr } from "@/lib/calculations/format";
import { getPart5Messages } from "@/lib/i18n/part5-messages";
import { getRun } from "@/lib/services/payments";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Payment run" };

function stamp(iso: string) {
  const time = new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: true }).toUpperCase();
  return `${formatDisplayDate(iso)}, ${time}`;
}

export default async function PaymentRunPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("payment_runs:create");
  const t = getPart5Messages(session.profile.preferred_lang).payments;
  const d = t.detail;
  const { id } = await params;

  const detail = await getRun(await createClient(), id);
  if (!detail) notFound();
  const { run, items, audit, centreNames } = detail;

  return (
    <div className="space-y-6">
      <BackLink href="/payments" label={d.back} />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" data-testid="run-no">{run.runNo}</h1>
          <p className="mt-1 text-sm text-muted">
            {formatDisplayDate(`${run.dateFrom}T06:30:00Z`)}{run.dateTo !== run.dateFrom && ` – ${formatDisplayDate(`${run.dateTo}T06:30:00Z`)}`} · {centreNames.join(", ")}
          </p>
        </div>
        <RunStatusBadge status={run.status} labels={t.runStatus} />
      </div>

      {run.status === "cancelled" && <Notice tone="warn">{d.cancelledNote}{run.cancelledReason ? `: ${run.cancelledReason}` : ""}</Notice>}

      <dl className="grid gap-3 sm:grid-cols-3">
        <Card><CardContent className="pt-4"><dt className="text-sm text-muted">{t.farmers}</dt><dd className="text-3xl font-bold tabular-nums">{run.itemCount}</dd></CardContent></Card>
        <Card><CardContent className="pt-4"><dt className="text-sm text-muted">{t.entries}</dt><dd className="text-3xl font-bold tabular-nums">{run.entryCount}</dd></CardContent></Card>
        <Card><CardContent className="pt-4"><dt className="text-sm text-muted">{t.total}</dt><dd className="text-3xl font-bold tabular-nums" data-testid="run-total">{formatInr(run.totalAmount)}</dd></CardContent></Card>
      </dl>

      <RunControls runId={run.id} status={run.status} total={run.totalAmount} t={d} />
      <RunItems runId={run.id} runStatus={run.status} items={items} t={t} />

      <Card>
        <CardHeader><CardTitle>{d.auditTitle}</CardTitle></CardHeader>
        <CardContent>
          <ol className="space-y-3" data-testid="run-audit">
            {audit.map((a) => (
              <li key={a.id} className="border-l-2 border-line pl-4">
                <p className="text-base font-semibold">{d.auditActions[a.action] ?? a.action}</p>
                <p className="text-sm text-muted">{stamp(a.at)}{a.actorName ? ` · ${d.by} ${a.actorName}` : ""}</p>
                {typeof a.details.reason === "string" && a.details.reason && <p className="text-sm">{d.reason}: {a.details.reason}</p>}
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
