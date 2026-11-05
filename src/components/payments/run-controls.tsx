"use client";

import { Download } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { formatInr } from "@/lib/calculations/format";
import type { Part5Messages } from "@/lib/i18n/part5-messages";
import type { RunStatus } from "@/lib/services/payments";

interface Props {
  runId: string;
  status: RunStatus;
  total: string;
  t: Part5Messages["payments"]["detail"];
}

/** Approve, download the (mock) bank file, or cancel. Which of these shows depends on the run's state. */
export function RunControls({ runId, status, total, t }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<"approve" | "file" | "cancel" | null>(null);
  const [checked, setChecked] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<{ tone: "info" | "error"; text: string } | null>(null);

  async function post(url: string, body?: unknown) {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).catch(() => null);
  }

  async function approve() {
    if (busy || !checked) return;
    setBusy("approve");
    setMessage(null);
    const response = await post(`/api/payment-runs/${runId}/approve`);
    setBusy(null);
    if (response?.ok) router.refresh();
    else setMessage({ tone: "error", text: t.failed });
  }

  async function download() {
    if (busy) return;
    setBusy("file");
    setMessage(null);
    const response = await post(`/api/payment-runs/${runId}/bank-file`);
    if (!response?.ok) {
      setBusy(null);
      setMessage({ tone: "error", text: t.failed });
      return;
    }
    const blob = await response.blob();
    const name = /filename="([^"]+)"/.exec(response.headers.get("Content-Disposition") ?? "")?.[1] ?? "bank-file.csv";
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setBusy(null);
    router.refresh();
  }

  async function cancel() {
    if (busy) return;
    if (reason.trim().length < 5) return setMessage({ tone: "error", text: t.cancelReason });
    setBusy("cancel");
    setMessage(null);
    const response = await post(`/api/payment-runs/${runId}/cancel`, { reason: reason.trim() });
    setBusy(null);
    if (response?.ok) router.refresh();
    else setMessage({ tone: "error", text: t.failed });
  }

  if (status === "cancelled") return null;

  return (
    <div className="space-y-4">
      {message && <Notice tone={message.tone}><span data-testid="run-message">{message.text}</span></Notice>}

      {status === "draft" && (
        <div className="space-y-3 rounded-xl border border-line bg-surface p-4">
          <p className="text-sm text-muted">{t.approveHint}</p>
          <label className="flex items-start gap-3 text-base">
            <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="mt-1 h-5 w-5 accent-[var(--primary)]" data-testid="approve-check" />
            <span>{t.approveConfirm} <strong>{formatInr(total)}</strong></span>
          </label>
          <Button size="lg" onClick={() => void approve()} disabled={!checked || busy !== null} data-testid="approve-run">
            {busy === "approve" ? t.approving : t.approve}
          </Button>
        </div>
      )}

      {(status === "approved" || status === "file_generated" || status === "completed") && (
        <div className="space-y-3 rounded-xl border border-line bg-surface p-4">
          <Notice tone="warn">{t.mockWarning}</Notice>
          <Button size="lg" variant={status === "approved" ? "primary" : "secondary"} onClick={() => void download()} disabled={busy !== null} data-testid="download-file">
            <Download className="h-5 w-5" aria-hidden="true" />
            {busy === "file" ? t.downloading : status === "approved" ? t.download : t.downloadAgain}
          </Button>
        </div>
      )}

      {(status === "draft" || status === "approved") && (
        <div className="space-y-3 rounded-xl border border-line bg-surface p-4">
          <p className="text-sm text-muted">{t.cancelHint}</p>
          {!cancelling ? (
            <Button variant="secondary" onClick={() => setCancelling(true)} data-testid="cancel-run">{t.cancel}</Button>
          ) : (
            <div className="space-y-2">
              <label htmlFor="cancel-reason" className="block text-sm font-semibold">{t.cancelReason}</label>
              <textarea id="cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={300} className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-base" data-testid="cancel-reason" />
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => void cancel()} disabled={busy !== null} data-testid="cancel-confirm">{t.cancelConfirm}</Button>
                <Button variant="ghost" onClick={() => setCancelling(false)}>{t.keep}</Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
