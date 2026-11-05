"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import type { Part5Messages } from "@/lib/i18n/part5-messages";

interface Props {
  from: string;
  to: string;
  centreIds: string[];
  t: Part5Messages["payments"]["new"];
}

/** Creates the run, then opens it for review. Pressing twice cannot create two runs: the button locks while busy and the database refuses entries already in a run. */
export function GenerateRunButton({ from, to, centreIds, t }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const response = await fetch("/api/payment-runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, centreIds }),
    }).catch(() => null);
    const body = response ? ((await response.json().catch(() => ({}))) as { run_id?: string; error?: string }) : {};
    if (response?.ok && body.run_id) {
      router.push(`/payments/${body.run_id}`);
      return; // stay busy while navigating
    }
    setError(body.error ?? "Could not generate the run. Please try again");
    setBusy(false);
  }

  return (
    <div className="space-y-3">
      {error && <Notice tone="error"><span data-testid="generate-error">{error}</span></Notice>}
      <Button size="lg" className="w-full sm:w-auto" onClick={() => void generate()} disabled={busy} data-testid="generate-run">
        {busy ? t.generating : t.generate}
      </Button>
      <p className="text-sm text-muted">{t.generateNote}</p>
    </div>
  );
}
