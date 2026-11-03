"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import type { Messages } from "@/lib/i18n/messages";

type Decision = "approve" | "hold" | "reject";

export function ReviewForm({ entryId, t }: { entryId: string; t: Messages["procurement"]["review"] }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<Decision | null>(null);
  const [message, setMessage] = useState<{ tone: "info" | "error"; text: string } | null>(null);

  async function submit(decision: Decision) {
    if (busy) return;
    if (decision !== "approve" && note.trim().length < 5) {
      setMessage({ tone: "error", text: t.needNote });
      return;
    }
    setBusy(decision);
    setMessage(null);
    const response = await fetch(`/api/procurement/${entryId}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision, note: note.trim() || undefined }),
    }).catch(() => null);
    if (response?.ok) {
      setMessage({ tone: "info", text: t.done });
      setNote("");
      router.refresh();
    } else {
      setMessage({ tone: "error", text: t.failed });
    }
    setBusy(null);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.title}</CardTitle>
        <p className="mt-1 text-sm text-muted">{t.intro}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <label htmlFor="review-note" className="mb-1.5 block text-sm font-semibold">{t.note}</label>
          <textarea
            id="review-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            rows={3}
            placeholder={t.notePlaceholder}
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-base"
          />
        </div>
        {message && <Notice tone={message.tone}>{message.text}</Notice>}
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button onClick={() => void submit("approve")} disabled={busy !== null} className="sm:flex-1">{t.approve}</Button>
          <Button variant="secondary" onClick={() => void submit("hold")} disabled={busy !== null} className="sm:flex-1">{t.hold}</Button>
          <Button variant="secondary" onClick={() => void submit("reject")} disabled={busy !== null} className="sm:flex-1">{t.reject}</Button>
        </div>
      </CardContent>
    </Card>
  );
}
