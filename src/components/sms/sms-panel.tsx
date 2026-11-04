"use client";

import { CheckCircle2, Clock, MessageSquareText, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { useOffline } from "@/components/offline/offline-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { useLocalQuery } from "@/hooks/use-local-query";
import { getLocalDb, type LocalEntry, type LocalNotification } from "@/lib/db/local";
import type { Part4Messages } from "@/lib/i18n/part4-messages";
import { queueSlipSms, retrySlipSms } from "@/lib/offline/sms-queue";
import type { SlipInput } from "@/lib/slip/slip";
import { buildSmsBody, smsLength, type SmsLanguage } from "@/lib/sms/message";
import { maskPhone, normalizeIndianMobile } from "@/lib/sms/phone";

function time(iso: string) {
  return new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: true }).toUpperCase();
}

/**
 * The farmer's SMS: a preview of exactly what will be sent, then its status.
 * "Delivered" appears only when the server reports the SMS service confirmed
 * it. A message that was merely handed to the service reads "sent, delivery
 * not confirmed", and one asked for while offline reads "queued".
 */
export function SmsPanel({
  entry,
  phone,
  slip,
  t,
}: {
  entry: LocalEntry;
  /** The farmer's number from the phone's cached registry, or null. */
  phone: string | null;
  slip: SlipInput;
  t: Part4Messages["sms"];
}) {
  const { online, operator, processSms } = useOffline();
  const note = useLocalQuery<LocalNotification | undefined>(() => getLocalDb().notifications.get(entry.clientId), undefined);
  const live = useLocalQuery<LocalEntry | undefined>(() => getLocalDb().entries.where("clientId").equals(entry.clientId).first(), entry);
  const entrySynced = (live ?? entry).syncStatus === "synced";

  const [language, setLanguage] = useState<SmsLanguage>("mr");
  const [simulate, setSimulate] = useState(false);
  const [busy, setBusy] = useState(false);

  const mobile = normalizeIndianMobile(phone);
  const masked = mobile ? maskPhone(mobile) : null;
  const body = buildSmsBody(slip, note?.language ?? language);
  const length = smsLength(body);
  const status = note?.status;

  // Send as soon as the entry is on the server; keep asking for the receipt while only "sent".
  useEffect(() => {
    if (!online) return;
    if (status === "queued" && entrySynced) void processSms();
    if (status !== "sent") return;
    const timer = window.setInterval(() => void processSms(), 2500);
    return () => window.clearInterval(timer);
  }, [online, status, entrySynced, processSms]);

  async function queue() {
    if (busy || !mobile) return;
    setBusy(true);
    try {
      await queueSlipSms(getLocalDb(), {
        entryClientId: entry.clientId,
        operatorId: operator.operatorId,
        farmerId: entry.farmerId,
        language,
        simulateFailure: simulate,
      });
      void processSms();
    } finally {
      setBusy(false);
    }
  }

  async function retry() {
    await retrySlipSms(getLocalDb(), entry.clientId, simulate);
    void processSms();
  }

  const reason = (code?: string) => (code ? (t.reasons[code] ?? code) : "");

  return (
    <section className="space-y-3 rounded-lg border border-line p-4 no-print" data-testid="sms-panel" aria-label={t.title}>
      <h3 className="flex items-center gap-2 text-lg font-bold">
        <MessageSquareText className="h-5 w-5" aria-hidden="true" />
        {t.title}
      </h3>

      {!mobile ? (
        <Notice tone="warn">{t.noPhone}</Notice>
      ) : (
        <>
          <div>
            <p className="text-sm font-semibold text-muted">{t.preview}</p>
            <p className="text-sm text-muted">
              {t.to}: <span className="font-semibold text-ink" data-testid="sms-recipient">{masked}</span>
            </p>
            <pre
              lang={note?.language ?? language}
              className="mt-2 whitespace-pre-wrap rounded-lg bg-primary-soft p-3 font-[inherit] text-base"
              data-testid="sms-preview"
            >
              {body}
            </pre>
            <p className="mt-1 text-xs text-muted" data-testid="sms-length">
              {length.encoding} · {length.characters} {t.characters} · {length.segments} {t.parts}
            </p>
          </div>

          {!note && (
            <div className="space-y-3">
              <div className="flex gap-2" role="group" aria-label={t.preview}>
                {(["mr", "en"] as const).map((l) => (
                  <button
                    key={l}
                    type="button"
                    aria-pressed={language === l}
                    onClick={() => setLanguage(l)}
                    className={`h-11 flex-1 rounded-lg border-2 text-base font-semibold ${language === l ? "border-primary bg-primary-soft text-primary" : "border-line"}`}
                  >
                    {l === "mr" ? "मराठी" : "English"}
                  </button>
                ))}
              </div>
              <label className="flex items-start gap-3 text-sm">
                <input type="checkbox" checked={simulate} onChange={(e) => setSimulate(e.target.checked)} className="mt-0.5 h-5 w-5 accent-[var(--primary)]" data-testid="sms-simulate" />
                <span>
                  {t.simulate}
                  <span className="block text-xs text-muted">{t.simulateHint}</span>
                </span>
              </label>
              {!online && <Notice tone="warn">{t.offlineQueued}</Notice>}
              <Button size="lg" className="w-full" onClick={() => void queue()} disabled={busy} data-testid="sms-send">
                {online && entrySynced ? t.send : t.queue}
              </Button>
            </div>
          )}

          {note && (
            <div className="space-y-2" data-testid="sms-status" data-status={note.status} aria-live="polite">
              <p className="text-sm font-semibold text-muted">{t.statusTitle}</p>
              {note.status === "queued" && (
                <>
                  <Badge tone="warn"><Clock className="h-3.5 w-3.5" aria-hidden="true" />{entrySynced ? t.queued : t.queuedWaitingEntry}</Badge>
                  {!online && <Notice tone="warn">{t.offlineQueued}</Notice>}
                </>
              )}
              {note.status === "sending" && <Badge tone="warn"><Clock className="h-3.5 w-3.5" aria-hidden="true" />{t.sending}</Badge>}
              {note.status === "sent" && <Badge tone="warn"><Clock className="h-3.5 w-3.5" aria-hidden="true" />{t.sent}</Badge>}
              {note.status === "delivered" && (
                <Badge tone="success"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />{t.delivered}</Badge>
              )}
              {note.status === "failed" && (
                <>
                  <Badge tone="danger"><TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />{t.failed}</Badge>
                  <p className="text-sm text-danger" data-testid="sms-reason">{reason(note.failureReason)}</p>
                  <Button size="sm" variant="secondary" onClick={() => void retry()} data-testid="sms-retry">{t.retry}</Button>
                </>
              )}
              {note.status === "unavailable" && (
                <>
                  <Badge tone="danger"><TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />{t.unavailable}</Badge>
                  <p className="text-sm text-danger">{reason(note.failureReason)}</p>
                </>
              )}
              {note.lastError && note.status === "queued" && <p className="text-xs text-muted">{reason(note.lastError)}</p>}
              {note.serverStatusAt && (
                <p className="text-xs text-muted">{t.lastUpdate}: {time(note.serverStatusAt)}</p>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
