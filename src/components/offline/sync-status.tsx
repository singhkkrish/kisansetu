"use client";

import { CheckCircle2, CloudOff, RefreshCw, TriangleAlert, Wifi } from "lucide-react";
import { useOffline } from "@/components/offline/offline-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { useLocalQuery } from "@/hooks/use-local-query";
import { formatDisplayDate } from "@/lib/calculations/format";
import { getLocalDb } from "@/lib/db/local";
import type { Messages } from "@/lib/i18n/messages";
import { getLastSyncAt } from "@/lib/offline/clock";
import { countByStatus, slipNumbersRemaining } from "@/lib/offline/queue";

interface Snapshot {
  pending: number;
  synced: number;
  failed: number;
  lastSyncAt: string | null;
  slipsLeft: number;
  farmers: number;
  lastError: string | null;
}

const EMPTY: Snapshot = { pending: 0, synced: 0, failed: 0, lastSyncAt: null, slipsLeft: 0, farmers: 0, lastError: null };

async function readSnapshot(): Promise<Snapshot> {
  const db = getLocalDb();
  const [counts, lastSyncAt, slipsLeft, farmers, pendingRows] = await Promise.all([
    countByStatus(db),
    getLastSyncAt(db),
    slipNumbersRemaining(db),
    db.members.count(),
    db.entries.where("syncStatus").equals("pending").toArray(),
  ]);
  return { ...counts, lastSyncAt, slipsLeft, farmers, lastError: pendingRows.find((e) => e.lastError)?.lastError ?? null };
}

function lastSyncLabel(iso: string | null, never: string): string {
  if (!iso) return never;
  const time = new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
  return `${formatDisplayDate(iso)}, ${time}`;
}

function Count({ label, value, tone }: { label: string; value: number; tone?: "warn" | "danger" }) {
  const color = value > 0 && tone === "danger" ? "text-danger" : value > 0 && tone === "warn" ? "text-warn" : "";
  return (
    <div>
      <dt className="text-sm text-muted">{label}</dt>
      <dd className={`text-4xl font-bold tabular-nums ${color}`}>{value}</dd>
    </div>
  );
}

/**
 * Shows the true state of the queue. "Synced" counts only entries the server
 * has confirmed; everything else is pending or failed. The last-sync time is
 * the last time the server actually answered, not the last time we tried.
 */
export function SyncStatus({ t }: { t: Messages["sync"] }) {
  const { online, syncing, refreshing, notice, syncNow, retryFailed, refreshData, getSlips } = useOffline();
  const snap = useLocalQuery(readSnapshot, EMPTY);

  const noticeText = (() => {
    switch (notice.kind) {
      case "data_updated": return { tone: "info" as const, text: t.dataUpdated };
      case "data_failed": return { tone: "warn" as const, text: t.dataFailed };
      case "slips_failed": return { tone: "error" as const, text: t.slipsFailed };
      case "result": {
        const s = notice.summary;
        if (s.stoppedBecause === "offline") return { tone: "warn" as const, text: t.offlineStopped };
        if (s.stoppedBecause === "signed_out") return { tone: "error" as const, text: t.signedOut };
        if (s.stoppedBecause === "server_error") return { tone: "error" as const, text: t.serverError };
        if (s.stoppedBecause === "busy" || s.attempted === 0) return null;
        const parts = [`${t.result}: ${s.accepted + s.duplicates + s.flagged}`];
        if (s.flagged > 0) parts.push(`${s.flagged} ${t.flaggedNote}`);
        if (s.rejected > 0) parts.push(`${s.rejected} ${t.rejectedNote}`);
        return { tone: s.flagged + s.rejected > 0 ? ("warn" as const) : ("info" as const), text: parts.join(" · ") };
      }
      default: return null;
    }
  })();

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{t.title}</CardTitle>
        <span
          data-testid="connection-state"
          className={`inline-flex items-center gap-1.5 text-sm font-semibold ${online ? "text-primary" : "text-warn"}`}
        >
          {online ? <Wifi className="h-4 w-4" aria-hidden="true" /> : <CloudOff className="h-4 w-4" aria-hidden="true" />}
          {online ? t.online : t.offline}
        </span>
      </CardHeader>
      <CardContent className="space-y-5">
        <dl className="grid grid-cols-3 gap-4" data-testid="sync-counts">
          <Count label={t.pending} value={snap.pending} tone="warn" />
          <Count label={t.synced} value={snap.synced} />
          <Count label={t.failed} value={snap.failed} tone="danger" />
        </dl>

        <dl className="grid grid-cols-2 gap-4 text-sm">
          <div className="col-span-2">
            <dt className="text-muted">{t.lastSync}</dt>
            <dd className="font-semibold" data-testid="last-sync">{lastSyncLabel(snap.lastSyncAt, t.never)}</dd>
          </div>
          <div>
            <dt className="text-muted">{t.slipsLeft}</dt>
            <dd className="font-semibold tabular-nums">{snap.slipsLeft}</dd>
          </div>
          <div>
            <dt className="text-muted">{t.farmersCached}</dt>
            <dd className="font-semibold tabular-nums">{snap.farmers}</dd>
          </div>
        </dl>

        {!online && <Notice tone="warn">{t.offlineHint}</Notice>}
        {snap.failed > 0 && (
          <Notice tone="error">
            <span className="inline-flex items-center gap-1.5"><TriangleAlert className="h-4 w-4" aria-hidden="true" />{t.failedHint}</span>
          </Notice>
        )}
        {snap.pending > 0 && snap.lastError && online && <Notice tone="warn">{t.lastAttemptFailed} {t.waitingToRetry}</Notice>}
        {noticeText && <Notice tone={noticeText.tone}>{noticeText.text}</Notice>}

        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <Button onClick={() => void syncNow()} disabled={syncing || !online || snap.pending === 0} className="sm:flex-1">
            <RefreshCw className={`h-5 w-5 ${syncing ? "animate-spin" : ""}`} aria-hidden="true" />
            {syncing ? t.syncing : t.syncNow}
          </Button>
          {snap.failed > 0 && (
            <Button variant="secondary" onClick={() => void retryFailed()} disabled={syncing || !online} className="sm:flex-1">
              {syncing ? t.retrying : t.retryFailed}
            </Button>
          )}
          <Button variant="secondary" onClick={() => void refreshData()} disabled={refreshing || !online} className="sm:flex-1">
            {refreshing ? t.refreshing : t.refreshData}
          </Button>
          {snap.slipsLeft < 30 && (
            <Button variant="secondary" onClick={() => void getSlips()} disabled={!online} className="sm:flex-1">
              {t.getSlips}
            </Button>
          )}
        </div>

        {snap.pending === 0 && snap.failed === 0 && (
          <p className="flex items-center gap-1.5 text-sm text-muted">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            {snap.synced > 0 ? t.allSynced : t.neverSyncedHint}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/** One-line version for the top of the entry screens. */
export function SyncBar({ t }: { t: Messages["sync"] }) {
  const { online, syncing } = useOffline();
  const snap = useLocalQuery(readSnapshot, EMPTY);
  return (
    <div
      data-testid="sync-bar"
      className={`flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border px-4 py-2 text-sm font-semibold ${online ? "border-line bg-primary-soft text-primary" : "border-warn/30 bg-warn-soft text-warn"}`}
    >
      <span className="inline-flex items-center gap-1.5">
        {online ? <Wifi className="h-4 w-4" aria-hidden="true" /> : <CloudOff className="h-4 w-4" aria-hidden="true" />}
        {online ? t.online : t.offline}
      </span>
      <span>{t.pending}: {snap.pending}</span>
      {snap.failed > 0 && <span className="text-danger">{t.failed}: {snap.failed}</span>}
      {syncing && <span>{t.syncing}</span>}
    </div>
  );
}
