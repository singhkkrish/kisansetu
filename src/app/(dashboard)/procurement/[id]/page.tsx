import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BackLink } from "@/components/members/back-link";
import { ReviewForm } from "@/components/procurement/review-form";
import { ApprovalBadge, PaymentBadge } from "@/components/procurement/status-badges";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { can } from "@/lib/auth/permissions";
import { requireAnyPermission } from "@/lib/auth/page-guard";
import { formatDisplayDate, formatInr, formatKg } from "@/lib/calculations/format";
import { getMessages } from "@/lib/i18n/messages";
import { getEntryDetail } from "@/lib/services/procurement-view";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Entry details" };

function stamp(iso: string) {
  return `${formatDisplayDate(iso)}, ${new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true })} IST`;
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="mt-0.5 text-base font-semibold">{children}</dd>
    </div>
  );
}

export default async function EntryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  // Either role may open this page; what they see is decided by row level security.
  const session = await requireAnyPermission("procurement:read_own_centre", "procurement:read_all");
  const { id } = await params;
  const t = getMessages(session.profile.preferred_lang);
  const p = t.procurement;

  const entry = await getEntryDetail(await createClient(), id);
  if (!entry) notFound();

  const manager = can(session.profile.role, "procurement:approve");
  const locked = entry.paymentStatus === "in_run" || entry.paymentStatus === "paid";

  return (
    <div className="space-y-6">
      <BackLink href="/procurement" label={p.backToList} />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{entry.slipNo}</h1>
          <p className="mt-1 text-base text-muted">{entry.farmerName} · {entry.farmerCode} · {entry.village}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ApprovalBadge status={entry.approvalStatus} t={p} />
          <PaymentBadge status={entry.paymentStatus} t={p} />
        </div>
      </div>

      {entry.flagReasons.length > 0 && (
        <Notice tone="warn">
          <p className="font-semibold">{p.flags}</p>
          <ul className="mt-1 list-disc pl-5">
            {entry.flagReasons.map((f) => <li key={f}>{p.flagLabels[f] ?? f}</li>)}
          </ul>
        </Notice>
      )}
      {entry.reviewNote && (
        <Notice tone="info"><span className="font-semibold">{p.reviewNote}:</span> {entry.reviewNote}</Notice>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>{p.figures}</CardTitle></CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-4">
              <Item label={p.crop}>{t.crops[entry.crop]} · {entry.grade}</Item>
              <Item label={p.rate}>{formatInr(entry.ratePerQuintal)}</Item>
              <Item label={p.gross}>{formatKg(entry.grossKg)} kg</Item>
              <Item label={p.tare}>{formatKg(entry.tareKg)} kg</Item>
              <Item label={p.moisture}>{entry.moisturePct}%</Item>
              <Item label={p.net}>{formatKg(entry.netKg)} kg</Item>
              <div className="col-span-2"><Item label={p.amount}><span className="text-2xl">{formatInr(entry.amount)}</span></Item></div>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>{p.audit}</CardTitle></CardHeader>
          <CardContent>
            <dl className="space-y-4">
              <Item label={p.createdBy}>{entry.operatorName ?? "—"} · {entry.centreCode}</Item>
              <div>
                <dt className="text-sm text-muted">{p.deviceTime}</dt>
                <dd className="text-base font-semibold" data-testid="device-time">{stamp(entry.deviceRecordedAt)}</dd>
                <dd className="text-xs text-muted">{p.deviceTimeNote}</dd>
              </div>
              <Item label={p.serverTime}><span data-testid="server-time">{stamp(entry.serverReceivedAt)}</span></Item>
              {entry.clockOffsetMs !== null && (
                <Item label={p.clockOffset}>{(entry.clockOffsetMs / 1000).toFixed(0)} s</Item>
              )}
            </dl>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>{p.audit}</CardTitle></CardHeader>
        <CardContent>
          <ol className="space-y-4" data-testid="audit-trail">
            {entry.audit.map((a) => (
              <li key={a.id} className="border-l-2 border-line pl-4">
                <p className="text-base font-semibold">{a.action === "created" ? p.auditCreated : p.auditChanged}</p>
                <p className="text-sm text-muted">{stamp(a.at)}{a.actorName ? ` · ${p.auditBy} ${a.actorName}` : ""}</p>
                {a.action !== "created" && a.newValues && (
                  <p className="mt-1 text-sm">
                    {String(a.oldValues?.approval_status ?? "")} → {String(a.newValues.approval_status ?? "")}
                    {a.newValues.review_note ? ` · “${String(a.newValues.review_note)}”` : ""}
                  </p>
                )}
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      {manager ? (
        locked ? <Notice tone="warn">{p.review.locked}</Notice> : <ReviewForm entryId={entry.id} t={p.review} />
      ) : (
        <Notice tone="info">{p.review.operatorReadOnly}</Notice>
      )}
    </div>
  );
}
