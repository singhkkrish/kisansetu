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
import { SlipCard } from "@/components/slip/slip-card";
import { getPart4Messages } from "@/lib/i18n/part4-messages";
import { getPart6Messages } from "@/lib/i18n/part6-messages";
import { AnomalyCard } from "@/components/anomalies/anomaly-card";
import { listEntryAnomalies } from "@/lib/services/anomalies";
import { SMS_COLUMNS, toSmsRecord } from "@/lib/services/sms-repository";
import { buildSlip } from "@/lib/slip/slip";
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

  const supabase = await createClient();
  const entry = await getEntryDetail(supabase, id);
  if (!entry) notFound();
  const t4 = getPart4Messages(session.profile.preferred_lang);
  const { data: smsRow } = await supabase
    .from("sms_messages")
    .select(SMS_COLUMNS)
    .eq("entry_id", entry.id)
    .maybeSingle();
  const sms = smsRow ? toSmsRecord(smsRow as Record<string, unknown>) : null;

  const manager = can(session.profile.role, "procurement:approve");
  const t6 = getPart6Messages(session.profile.preferred_lang);
  // Row level security hides anomaly flags from operators; only managers load them.
  const anomalies = manager ? await listEntryAnomalies(supabase, entry.id) : [];
  const openAnomaly = anomalies.some((a) => a.status === "open");
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

      {manager && (
        <section className="space-y-3" aria-labelledby="anomalies-title">
          <h2 id="anomalies-title" className="text-xl font-bold">{t6.anomalies.sectionTitle}</h2>
          {anomalies.length === 0 ? (
            <p className="text-muted">{t6.anomalies.noneOnEntry}</p>
          ) : (
            anomalies.map((a) => <AnomalyCard key={a.id} item={a} t={t6.anomalies} lang={session.profile.preferred_lang} showEntryLink={false} />)
          )}
        </section>
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
              {entry.readings && (
                <div className="col-span-2" data-testid="reading-sources">
                  <dt className="text-sm text-muted">{t6.sources.title}</dt>
                  <dd className="mt-0.5 space-y-0.5 text-base">
                    {(["grossKg", "tareKg", "moisturePct"] as const).map((f) => {
                      const m = entry.readings?.[f];
                      if (!m) return null;
                      return (
                        <span key={f} className="block">
                          {t6.sources.fields[f]}: <span className="font-semibold">{t6.sources[m.source]}</span>
                          {m.aiValue && m.source !== "ai_confirmed" ? ` (${t6.sources.aiWas} ${m.aiValue})` : ""}
                        </span>
                      );
                    })}
                  </dd>
                </div>
              )}
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
        <CardHeader><CardTitle>{t4.slip.forFarmer}</CardTitle></CardHeader>
        <CardContent>
          <SlipCard
            lang="both"
            model={buildSlip({
              slipNo: entry.slipNo,
              farmerName: entry.farmerName,
              farmerCode: entry.farmerCode,
              village: entry.village,
              centreName: entry.centreName,
              centreCode: entry.centreCode,
              crop: entry.crop,
              grade: entry.grade,
              grossKg: entry.grossKg,
              tareKg: entry.tareKg,
              moisturePct: entry.moisturePct,
              ratePerQuintal: entry.ratePerQuintal,
              netKg: entry.netKg,
              amount: entry.amount,
              rateDate: entry.rateDate,
              rateVersion: entry.rateVersion,
              recordedAt: entry.deviceRecordedAt,
              serverReceivedAt: entry.serverReceivedAt,
              paymentStatus: entry.paymentStatus,
            })}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t4.sms.managerTitle}</CardTitle></CardHeader>
        <CardContent data-testid="manager-sms">
          {sms ? (
            <dl className="space-y-3">
              <Item label={t4.sms.statusTitle}>
                <span data-testid="manager-sms-status" data-status={sms.status}>{t4.sms[sms.status === "sending" ? "sending" : sms.status]}</span>
                {sms.failureReason && <span className="block text-sm font-normal text-muted">{t4.sms.reasons[sms.failureReason] ?? sms.failureReason}</span>}
              </Item>
              <Item label={t4.sms.to}>{sms.recipientMasked}</Item>
              <div>
                <dt className="text-sm text-muted">{t4.sms.preview}</dt>
                <dd lang={sms.language} className="mt-0.5 whitespace-pre-wrap rounded-lg border border-line bg-primary-soft p-3 text-base">{sms.body}</dd>
              </div>
              <Item label={t4.sms.recorded}>{stamp(sms.statusAt)}</Item>
              <Item label={t4.sms.attempts}>{sms.attempts}</Item>
            </dl>
          ) : (
            <p className="text-muted">{t4.sms.managerNone}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{p.audit}</CardTitle></CardHeader>
        <CardContent>
          <ol className="space-y-4" data-testid="audit-trail">
            {entry.audit.map((a) => (
              <li key={a.id} className="border-l-2 border-line pl-4">
                <p className="text-base font-semibold">{a.action === "created" ? p.auditCreated : (t6.anomalies.audit[a.action] ?? p.auditChanged)}</p>
                <p className="text-sm text-muted">{stamp(a.at)}{a.actorName ? ` · ${p.auditBy} ${a.actorName}` : ""}</p>
                {a.action.startsWith("anomaly_") && a.newValues && (
                  <p className="mt-1 text-sm">
                    {t6.anomalies.rules[String(a.newValues.rule)] ?? String(a.newValues.rule ?? "")}
                    {a.newValues.note ? ` · “${String(a.newValues.note)}”` : ""}
                  </p>
                )}
                {a.action !== "created" && !a.action.startsWith("anomaly_") && a.newValues && (
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
        locked ? <Notice tone="warn">{p.review.locked}</Notice> : (
          <>
            {openAnomaly && <Notice tone="warn">{t6.anomalies.approveBlocked}</Notice>}
            <ReviewForm entryId={entry.id} t={p.review} />
          </>
        )
      ) : (
        <Notice tone="info">{p.review.operatorReadOnly}</Notice>
      )}
    </div>
  );
}
