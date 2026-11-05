"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { Part5Messages } from "@/lib/i18n/part5-messages";

type Decision = "approve" | "hold" | "reject";

interface Props {
  entryId: string;
  slipNo: string;
  approvalStatus: "approved" | "held" | "rejected";
  paymentStatus: string;
  flagged: boolean;
  t: Part5Messages["review"];
}

/**
 * Review buttons for one row. Hold and reject need a written reason; approving
 * an entry the server flagged needs the manager to confirm they read the flags.
 * The database enforces the same rules again.
 */
export function ReviewActions({ entryId, slipNo, approvalStatus, paymentStatus, flagged, t }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState<Decision | null>(null);
  const [note, setNote] = useState("");
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const locked = paymentStatus === "in_run" || paymentStatus === "paid";
  if (locked) {
    return (
      <div className="flex flex-col items-start gap-1">
        <span className="text-xs font-semibold text-muted">{t.inRun}</span>
        <Link href={`/procurement/${entryId}`} className="text-sm font-semibold text-primary underline">{t.open}</Link>
      </div>
    );
  }

  function start(decision: Decision) {
    setMessage(null);
    setNote("");
    setChecked(false);
    setOpen(decision);
  }

  async function submit() {
    if (!open || busy) return;
    if (open !== "approve" && note.trim().length < 5) return setMessage({ tone: "error", text: t.needReason });
    if (open === "approve" && flagged && !checked) return setMessage({ tone: "error", text: t.needConfirm });
    setBusy(true);
    setMessage(null);
    const response = await fetch(`/api/procurement/${entryId}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: open, note: open === "approve" ? note.trim() || undefined : note.trim() }),
    }).catch(() => null);
    setBusy(false);
    if (response?.ok) {
      setOpen(null);
      router.refresh();
    } else {
      setMessage({ tone: "error", text: t.failed });
    }
  }

  const labels: Record<Decision, string> = { approve: t.approve, hold: t.hold, reject: t.reject };

  return (
    <div className="space-y-2" data-testid={`review-${slipNo}`}>
      <div className="flex flex-wrap gap-1.5">
        <Link href={`/procurement/${entryId}`} className="inline-flex h-10 items-center rounded-lg border border-line px-3 text-sm font-semibold text-primary">{t.open}</Link>
        {approvalStatus !== "approved" && (
          <Button size="sm" onClick={() => start("approve")} data-testid={`approve-${slipNo}`}>{t.approve}</Button>
        )}
        {approvalStatus !== "held" && (
          <Button size="sm" variant="secondary" onClick={() => start("hold")} data-testid={`hold-${slipNo}`}>{t.hold}</Button>
        )}
        {approvalStatus !== "rejected" && (
          <Button size="sm" variant="secondary" onClick={() => start("reject")} data-testid={`reject-${slipNo}`}>{t.reject}</Button>
        )}
      </div>

      {open && (
        <div className="space-y-2 rounded-lg border border-line bg-primary-soft p-3" role="group" aria-label={labels[open]}>
          <p className="text-sm font-semibold">{labels[open]} · {slipNo}</p>
          <label className="block text-sm font-semibold" htmlFor={`note-${entryId}`}>{t.reasonLabel}</label>
          <textarea
            id={`note-${entryId}`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder={t.reasonHint}
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-base"
            data-testid="review-note"
          />
          {open === "approve" && flagged && (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="mt-0.5 h-5 w-5 accent-[var(--primary)]" data-testid="review-confirm-flagged" />
              {t.confirmFlagged}
            </label>
          )}
          {message && <p role="alert" className={`text-sm font-semibold ${message.tone === "error" ? "text-danger" : ""}`}>{message.text}</p>}
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void submit()} disabled={busy} data-testid="review-submit">{t.confirm}</Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(null)} disabled={busy}>{t.cancel}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
