"use client";

import { CheckCircle2, Lock, PencilLine } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { formatDisplayDate, formatInr } from "@/lib/calculations/format";
import type { Messages } from "@/lib/i18n/messages";
import type { Part4Messages } from "@/lib/i18n/part4-messages";
import { MAX_DAYS_AHEAD, addDays, pendingDrafts, priceRate, slotState, type BoardSlot } from "@/lib/prices/price-board";
import { sanitizeDecimal } from "@/lib/procurement/wizard";

interface Props {
  date: string;
  todayIst: string;
  slots: BoardSlot[];
  t: Messages;
  t4: Part4Messages;
}

const key = (s: BoardSlot) => `${s.crop}|${s.grade}`;

function stamp(iso: string) {
  const time = new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: true }).toUpperCase();
  return `${formatDisplayDate(iso)}, ${time}`;
}

export function PriceBoard({ date, todayIst, slots, t, t4 }: Props) {
  const p = t4.prices;
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);

  const editable = date >= todayIst && date <= addDays(todayIst, MAX_DAYS_AHEAD);
  const [values, setValues] = useState<Record<string, string>>(
    () => Object.fromEntries(slots.map((s) => [key(s), s.draft?.rate.replace(/\.00$/, "") ?? ""])),
  );
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const drafts = pendingDrafts(slots);
  const base = (s: BoardSlot) => s.draft?.rate ?? s.published?.rate ?? "";

  /** Rows the operator typed a different rate into. */
  const changed = slots.filter((s) => {
    const v = values[key(s)]?.trim();
    return v !== "" && priceRate.safeParse(v).success && Number(v) !== Number(base(s));
  });
  const needsReason = changed.some((s) => s.published !== null);

  async function call(url: string, init: RequestInit) {
    const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } }).catch(() => null);
    const body = response ? ((await response.json().catch(() => ({}))) as { error?: string; fieldErrors?: Record<string, string> }) : {};
    return { ok: response?.ok ?? false, body };
  }

  async function save() {
    setMessage(null);
    setFieldErrors({});
    if (changed.length === 0) {
      setMessage({ tone: "error", text: p.needRate });
      return;
    }
    setBusy(true);
    const result = await call("/api/prices", {
      method: "POST",
      body: JSON.stringify({
        date,
        rows: changed.map((s) => ({ crop: s.crop, grade: s.grade, rate: values[key(s)].trim() })),
        ...(needsReason ? { reason: reason.trim() } : {}),
      }),
    });
    setBusy(false);
    if (!result.ok) {
      setFieldErrors(result.body.fieldErrors ?? {});
      setMessage({ tone: "error", text: result.body.fieldErrors ? result.body.error ?? p.failed : p.failed });
      return;
    }
    setReason("");
    setMessage({ tone: "info", text: p.savedOk });
    router.refresh();
  }

  async function discard(slot: BoardSlot) {
    if (!slot.draft) return;
    setBusy(true);
    const result = await call(`/api/prices/${slot.draft.id}`, { method: "DELETE" });
    setBusy(false);
    if (!result.ok) {
      setMessage({ tone: "error", text: p.failed });
      return;
    }
    setValues((v) => ({ ...v, [key(slot)]: "" }));
    setMessage({ tone: "info", text: p.discardedOk });
    router.refresh();
  }

  function openConfirm() {
    setConfirmed(false);
    dialog.current?.showModal();
  }

  async function publish() {
    if (!confirmed) return;
    setBusy(true);
    const result = await call("/api/prices/publish", {
      method: "POST",
      body: JSON.stringify({ ids: drafts.map((s) => s.draft!.id), confirm: true }),
    });
    setBusy(false);
    dialog.current?.close();
    if (!result.ok) {
      setMessage({ tone: "error", text: p.failed });
      return;
    }
    setMessage({ tone: "info", text: p.publishedOk });
    router.refresh();
  }

  const badge = (s: BoardSlot) => {
    const state = slotState(s);
    if (state === "published") return <Badge tone="success"><Lock className="h-3.5 w-3.5" aria-hidden="true" />{p.statePublished}</Badge>;
    if (state === "draft") return <Badge tone="warn"><PencilLine className="h-3.5 w-3.5" aria-hidden="true" />{p.stateDraft}</Badge>;
    if (state === "correction") return <Badge tone="warn"><PencilLine className="h-3.5 w-3.5" aria-hidden="true" />{p.stateCorrection}</Badge>;
    return <Badge>{p.stateEmpty}</Badge>;
  };

  return (
    <div className="space-y-6">
      <form method="get" action="/prices" className="flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="date">{p.effectiveDate}</Label>
          <Input id="date" name="date" type="date" defaultValue={date} className="w-48" data-testid="price-date" />
        </div>
        <Button type="submit" variant="secondary">{p.showDate}</Button>
        <Link href="/prices/history" className="ml-auto text-sm font-semibold text-primary underline">{p.history}</Link>
      </form>

      <p className="text-sm text-muted">{p.intro}</p>
      {message && <Notice tone={message.tone === "error" ? "error" : "info"}><span data-testid="board-message">{message.text}</span></Notice>}
      {!editable && <Notice tone="warn">{date < todayIst ? t4.prices.lockedNote : p.failed}</Notice>}

      <ul className="space-y-3" data-testid="price-slots">
        {slots.map((s) => {
          const id = `rate-${s.crop}-${s.grade}`;
          const state = slotState(s);
          return (
            <li key={key(s)}>
              <Card data-testid={`slot-${s.crop}-${s.grade}`} data-state={state}>
                <CardContent className="space-y-3 pt-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-lg font-bold">
                      {t.crops[s.crop]} <span className="font-normal text-muted">{t.dashboard.grade} {s.grade}</span>
                    </p>
                    {badge(s)}
                  </div>

                  <div className="text-sm text-muted">
                    {s.published ? (
                      <p data-testid={`published-${s.crop}-${s.grade}`}>
                        {p.published}: <span className="text-lg font-bold tabular-nums text-ink">{formatInr(s.published.rate)}</span>{" "}
                        · {p.version} {s.published.version}
                        {s.published.publishedAt ? ` · ${p.by} ${s.published.publishedByName ?? "—"}, ${stamp(s.published.publishedAt)}` : ""}
                      </p>
                    ) : (
                      <p>{p.notPublished}</p>
                    )}
                    {s.draft && s.draft.correctionReason && <p>{p.reason}: {s.draft.correctionReason}</p>}
                  </div>

                  {editable && (
                    <div className="flex flex-wrap items-end gap-3">
                      <div className="min-w-0 flex-1">
                        <Label htmlFor={id}>{s.published ? p.correctRate : p.newRate} ({p.perQuintal})</Label>
                        <Input
                          id={id}
                          inputMode="decimal"
                          autoComplete="off"
                          value={values[key(s)] ?? ""}
                          onChange={(e) => setValues((v) => ({ ...v, [key(s)]: sanitizeDecimal(e.target.value, 2) }))}
                          placeholder={s.published ? s.published.rate : ""}
                          className="h-14 text-xl"
                          aria-invalid={fieldErrors[`rows.${slots.indexOf(s)}.rate`] ? true : undefined}
                        />
                      </div>
                      {s.draft && (
                        <Button variant="ghost" size="sm" onClick={() => void discard(s)} disabled={busy} data-testid={`discard-${s.crop}-${s.grade}`}>
                          {p.discard}
                        </Button>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>

      {editable && needsReason && (
        <div>
          <Label htmlFor="reason">{p.reasonLabel}</Label>
          <Input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder={p.reasonHint} aria-invalid={fieldErrors.reason ? true : undefined} data-testid="price-reason" />
          {fieldErrors.reason && <p className="mt-1.5 text-sm font-semibold text-danger">{fieldErrors.reason}</p>}
        </div>
      )}
      {fieldErrors.date && <p className="text-sm font-semibold text-danger">{fieldErrors.date}</p>}

      {editable && (
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button size="lg" variant="secondary" className="flex-1" onClick={() => void save()} disabled={busy} data-testid="save-drafts">
            {busy ? p.saving : p.saveDrafts}
          </Button>
          <Button size="lg" className="flex-1" onClick={openConfirm} disabled={busy || drafts.length === 0} data-testid="review-publish">
            {p.reviewPublish}
          </Button>
        </div>
      )}
      {editable && drafts.length === 0 && <p className="text-sm text-muted">{p.nothingToPublish}</p>}
      <p className="text-sm text-muted">{p.draftsHidden}</p>

      <dialog
        ref={dialog}
        aria-labelledby="publish-title"
        className="m-auto w-[min(92vw,34rem)] rounded-xl border-2 border-ink bg-surface p-0 text-ink backdrop:bg-black/50"
        data-testid="publish-dialog"
      >
        <div className="space-y-4 p-5">
          <h2 id="publish-title" className="text-xl font-bold">{p.confirmTitle}</h2>
          <p className="text-sm text-muted">{p.confirmIntro}</p>
          <p className="text-sm font-semibold">{p.effectiveDate}: {formatDisplayDate(`${date}T06:30:00Z`)}</p>
          <ul className="divide-y divide-line rounded-lg border border-line px-3" data-testid="publish-list">
            {drafts.map((s) => (
              <li key={key(s)} className="flex flex-wrap items-baseline justify-between gap-2 py-2.5">
                <span className="font-semibold">{t.crops[s.crop]} · {t.dashboard.grade} {s.grade}</span>
                <span className="tabular-nums">
                  {s.published && <span className="text-muted line-through">{formatInr(s.published.rate)} </span>}
                  <span className="text-lg font-bold">{formatInr(s.draft!.rate)}</span>
                  {s.published && <Badge tone="warn" className="ml-2">{p.confirmCorrection}</Badge>}
                </span>
                {s.draft!.correctionReason && <span className="w-full text-xs text-muted">{p.reason}: {s.draft!.correctionReason}</span>}
              </li>
            ))}
          </ul>
          <label className="flex items-start gap-3 text-base">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-1 h-5 w-5 accent-[var(--primary)]" data-testid="publish-check" />
            {p.confirmCheck}
          </label>
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button variant="secondary" size="lg" onClick={() => dialog.current?.close()} disabled={busy}>{p.cancel}</Button>
            <Button size="lg" onClick={() => void publish()} disabled={!confirmed || busy} data-testid="publish-confirm">
              <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
              {busy ? p.publishing : p.confirmPublish}
            </Button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
