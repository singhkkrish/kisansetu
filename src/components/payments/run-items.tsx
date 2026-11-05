"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ItemStatusBadge } from "@/components/payments/status-badges";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { Select } from "@/components/ui/select";
import { formatInr } from "@/lib/calculations/format";
import type { Part5Messages } from "@/lib/i18n/part5-messages";
import type { RunItem, RunStatus } from "@/lib/services/payments";

interface Props {
  runId: string;
  runStatus: RunStatus;
  items: RunItem[];
  t: Part5Messages["payments"];
}

/**
 * The payment items of a run, one row per farmer. Once the file has been
 * downloaded the manager can simulate the bank's answer for payments that are
 * processing. Failed payments stay on the list with their reason.
 */
export function RunItems({ runId, runStatus, items, t }: Props) {
  const d = t.detail;
  const router = useRouter();
  const processing = items.filter((i) => i.status === "processing" && !i.released);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reasonChoice, setReasonChoice] = useState(d.failReasons[0]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "info" | "error"; text: string } | null>(null);

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function simulate(outcome: "paid" | "failed") {
    if (busy || selected.size === 0) return;
    setBusy(true);
    setMessage(null);
    const response = await fetch(`/api/payment-runs/${runId}/simulate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemIds: [...selected], outcome, ...(outcome === "failed" ? { reason: reasonChoice } : {}) }),
    }).catch(() => null);
    setBusy(false);
    if (response?.ok) {
      setSelected(new Set());
      setMessage({ tone: "info", text: d.done });
      router.refresh();
    } else {
      setMessage({ tone: "error", text: d.failed });
    }
  }

  async function release(id: string) {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    const response = await fetch(`/api/payment-items/${id}/release`, { method: "POST" }).catch(() => null);
    setBusy(false);
    if (response?.ok) router.refresh();
    else setMessage({ tone: "error", text: d.failed });
  }

  const canSimulate = runStatus === "file_generated" && processing.length > 0;
  const hasFailedOpen = items.some((i) => i.status === "failed" && !i.released);

  return (
    <div className="space-y-4">
      {hasFailedOpen && <Notice tone="error"><span data-testid="failed-banner">{d.failedBanner}</span></Notice>}
      {message && <Notice tone={message.tone}><span data-testid="items-message">{message.text}</span></Notice>}

      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full min-w-[60rem] text-left text-base" data-testid="items-table">
          <thead className="border-b border-line text-sm text-muted">
            <tr>
              {canSimulate && <th scope="col" className="w-10 px-3 py-3"><span className="sr-only">{d.selectItems}</span></th>}
              {[t.table.farmerId, t.table.farmer, t.table.account, t.table.ifsc, t.table.entries, t.table.amount, t.table.status].map((c, i) => (
                <th key={c} scope="col" className={`px-4 py-3 font-semibold ${i === 4 || i === 5 ? "text-right" : ""}`}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {items.map((i) => (
              <tr key={i.id} data-testid={`item-${i.farmerCode}`} data-status={i.status}>
                {canSimulate && (
                  <td className="px-3 py-3">
                    {i.status === "processing" && !i.released && (
                      <input type="checkbox" checked={selected.has(i.id)} onChange={() => toggle(i.id)} aria-label={`${d.selectItems}: ${i.farmerName}`} className="h-5 w-5 accent-[var(--primary)]" data-testid={`select-${i.farmerCode}`} />
                    )}
                  </td>
                )}
                <td className="px-4 py-3 font-semibold">{i.farmerCode}</td>
                <td className="px-4 py-3">{i.farmerName}<span className="block text-xs text-muted">{i.paymentRef}</span></td>
                <td className="px-4 py-3 font-mono text-sm">{i.accountMasked}</td>
                <td className="px-4 py-3 font-mono text-sm">{i.ifsc}</td>
                <td className="px-4 py-3 text-right tabular-nums">{i.entryCount}</td>
                <td className="px-4 py-3 text-right font-bold tabular-nums">{formatInr(i.amount)}</td>
                <td className="px-4 py-3">
                  <ItemStatusBadge status={i.status} labels={t.itemStatus} />
                  {i.bankReference && <span className="mt-1 block text-xs text-muted">{d.bankRef}: {i.bankReference}</span>}
                  {i.failureReason && <span className="mt-1 block text-xs font-semibold text-danger">{d.reason}: {i.failureReason}</span>}
                  {i.released && <span className="mt-1 block text-xs text-muted">{t.returned}</span>}
                  {i.status === "failed" && !i.released && (
                    <Button size="sm" variant="secondary" className="mt-2" onClick={() => void release(i.id)} disabled={busy} data-testid={`release-${i.farmerCode}`}>{d.release}</Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hasFailedOpen && <p className="text-sm text-muted">{d.releaseHint}</p>}

      {runStatus === "file_generated" && (
        <section className="space-y-3 rounded-xl border border-line bg-surface p-4" aria-labelledby="sim-title">
          <h3 id="sim-title" className="text-lg font-bold">{d.simulateTitle}</h3>
          <p className="text-sm text-muted">{d.simulateIntro}</p>
          {processing.length === 0 ? (
            <p className="text-sm text-muted">{d.nothingProcessing}</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="secondary" size="sm" onClick={() => setSelected(new Set(processing.map((p) => p.id)))}>{t.new.selectAll} ({processing.length})</Button>
                <span className="text-sm text-muted">{selected.size} / {processing.length}</span>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <Button onClick={() => void simulate("paid")} disabled={busy || selected.size === 0} data-testid="mark-paid">{d.markPaid}</Button>
                <div className="min-w-60">
                  <label htmlFor="fail-reason" className="mb-1 block text-sm font-semibold">{d.failReason}</label>
                  <Select id="fail-reason" value={reasonChoice} onChange={(e) => setReasonChoice(e.target.value)} data-testid="fail-reason">
                    {d.failReasons.map((r) => <option key={r} value={r}>{r}</option>)}
                  </Select>
                </div>
                <Button variant="secondary" onClick={() => void simulate("failed")} disabled={busy || selected.size === 0} data-testid="mark-failed">{d.markFailed}</Button>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
