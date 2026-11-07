"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import type { Part6Messages } from "@/lib/i18n/part6-messages";

type Action = "reviewed" | "confirmed" | "false_positive" | "note";
const ACTIONS: Action[] = ["reviewed", "confirmed", "false_positive", "note"];
const NEEDS_NOTE: Action[] = ["confirmed", "false_positive", "note"];

/** Review buttons for one anomaly. The server enforces the same rules and audits every action. */
export function AnomalyActions({ flagId, t }: { flagId: string; t: Part6Messages["anomalies"] }) {
  const router = useRouter();
  const [open, setOpen] = useState<Action | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "info" | "error"; text: string } | null>(null);

  async function submit() {
    if (!open || busy) return;
    if (NEEDS_NOTE.includes(open) && note.trim().length < 5) {
      setMessage({ tone: "error", text: t.needNote });
      return;
    }
    setBusy(true);
    setMessage(null);
    const response = await fetch(`/api/anomalies/${flagId}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: open, note: note.trim() || undefined }),
    }).catch(() => null);
    setBusy(false);
    if (response?.ok) {
      setOpen(null);
      setNote("");
      setMessage({ tone: "info", text: t.done });
      router.refresh();
    } else {
      setMessage({ tone: "error", text: t.failed });
    }
  }

  return (
    <div className="space-y-2" data-testid={`anomaly-actions-${flagId}`}>
      {!open && (
        <div className="flex flex-wrap gap-2">
          {ACTIONS.map((a) => (
            <Button key={a} size="sm" variant="secondary" onClick={() => { setOpen(a); setMessage(null); }} data-testid={`action-${a}`}>
              {t.actions[a]}
            </Button>
          ))}
        </div>
      )}
      {open && (
        <div className="space-y-2 rounded-lg border border-line bg-primary-soft p-3">
          <p className="text-sm font-semibold">{t.actions[open]}</p>
          <p className="text-sm text-muted">{t.actionHelp[open]}</p>
          <label htmlFor={`note-${flagId}`} className="block text-sm font-semibold">{t.noteLabel}</label>
          <textarea
            id={`note-${flagId}`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            rows={2}
            placeholder={NEEDS_NOTE.includes(open) ? t.noteHint : undefined}
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-base"
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void submit()} disabled={busy} data-testid="action-save">{t.save}</Button>
            <Button size="sm" variant="ghost" onClick={() => { setOpen(null); setNote(""); setMessage(null); }} disabled={busy}>{t.cancel}</Button>
          </div>
        </div>
      )}
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
    </div>
  );
}
