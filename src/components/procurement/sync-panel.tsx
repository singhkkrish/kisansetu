"use client";

import { RefreshCw, Wifi, WifiOff } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { useLocalQuery } from "@/hooks/use-local-query";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { getLocalDb } from "@/lib/db/local";
import type { Messages } from "@/lib/i18n/messages";
import {
  countPending,
  getOrCreateDeviceId,
  setSlipBlock,
  slipNumbersRemaining,
} from "@/lib/offline/queue";
import { syncPending, type SyncSummary } from "@/lib/offline/sync";

interface Message {
  tone: "info" | "warn" | "error";
  text: string;
}

export function SyncPanel({ t }: { t: Messages["sync"] }) {
  const online = useOnlineStatus();
  const pending = useLocalQuery(() => countPending(getLocalDb()), 0);
  const slipsLeft = useLocalQuery(() => slipNumbersRemaining(getLocalDb()), 0);
  const [busy, setBusy] = useState<"sync" | "slips" | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const busyRef = useRef(false);

  const describe = useCallback(
    (summary: SyncSummary): Message => {
      if (summary.stoppedBecause === "offline") return { tone: "warn", text: t.offlineStopped };
      if (summary.stoppedBecause === "signed_out") return { tone: "error", text: t.signedOut };
      if (summary.stoppedBecause === "server_error") return { tone: "error", text: t.serverError };
      if (summary.attempted === 0) return { tone: "info", text: t.nothingPending };

      const parts = [`${t.result}: ${summary.accepted + summary.duplicates}`];
      if (summary.flagged > 0) parts.push(`${summary.flagged} ${t.flaggedNote}`);
      if (summary.rejected > 0) parts.push(`${summary.rejected} ${t.rejectedNote}`);
      const needsAttention = summary.flagged > 0 || summary.rejected > 0;
      return { tone: needsAttention ? "warn" : "info", text: parts.join(" · ") };
    },
    [t],
  );

  const syncNow = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy("sync");
    try {
      const db = getLocalDb();
      const deviceId = await getOrCreateDeviceId(db);
      setMessage(describe(await syncPending(db, { deviceId })));
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }, [describe]);

  const getSlips = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy("slips");
    try {
      const db = getLocalDb();
      const deviceId = await getOrCreateDeviceId(db);
      const response = await fetch("/api/slip-block", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId }),
      });
      if (!response.ok) throw new Error(String(response.status));
      const block = (await response.json()) as { centreCode: string; start: number; end: number };
      await setSlipBlock(db, block);
      setMessage({ tone: "info", text: t.slipsReceived });
    } catch {
      setMessage({ tone: "error", text: t.slipsFailed });
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }, [t]);

  // Send whatever is queued as soon as the connection comes back.
  useEffect(() => {
    const onOnline = () => void syncNow();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [syncNow]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{t.title}</CardTitle>
        <span
          className={`inline-flex items-center gap-1.5 text-sm font-semibold ${online ? "text-primary" : "text-warn"}`}
        >
          {online ? <Wifi className="h-4 w-4" aria-hidden="true" /> : <WifiOff className="h-4 w-4" aria-hidden="true" />}
          {online ? t.online : t.offline}
        </span>
      </CardHeader>
      <CardContent className="space-y-5">
        <dl className="grid grid-cols-2 gap-4">
          <div>
            <dt className="text-sm text-muted">{t.pending}</dt>
            <dd className="text-4xl font-bold tabular-nums">{pending}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted">{t.slipsLeft}</dt>
            <dd className="text-4xl font-bold tabular-nums">{slipsLeft}</dd>
          </div>
        </dl>

        {message && <Notice tone={message.tone}>{message.text}</Notice>}

        <div className="flex flex-col gap-3 sm:flex-row">
          <Button onClick={syncNow} disabled={busy !== null || pending === 0} className="sm:flex-1">
            <RefreshCw className={`h-5 w-5 ${busy === "sync" ? "animate-spin" : ""}`} aria-hidden="true" />
            {busy === "sync" ? t.syncing : t.syncNow}
          </Button>
          <Button variant="secondary" onClick={getSlips} disabled={busy !== null || !online} className="sm:flex-1">
            {busy === "slips" ? t.gettingSlips : t.getSlips}
          </Button>
        </div>

        {pending === 0 && !message && <p className="text-sm text-muted">{t.allSynced}</p>}
      </CardContent>
    </Card>
  );
}
