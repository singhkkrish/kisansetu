"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { getLocalDb } from "@/lib/db/local";
import { precachePages, registerServiceWorker } from "@/lib/offline/precache";
import {
  getOrCreateDeviceId,
  setSlipBlock,
  slipNumbersRemaining,
} from "@/lib/offline/queue";
import { downloadReferenceData, referenceDataAge } from "@/lib/offline/reference-data";
import { markSyncSucceeded } from "@/lib/offline/clock";
import { processSmsQueue } from "@/lib/offline/sms-queue";
import { retryFailedEntries, syncPending, type SyncSummary } from "@/lib/offline/sync";

export interface OperatorInfo {
  operatorId: string;
  centreId: string;
  centreCode: string;
  /** For the slip. Optional so older callers keep working. */
  centreName?: string;
}

export type SyncNotice =
  | { kind: "idle" }
  | { kind: "result"; summary: SyncSummary }
  | { kind: "data_updated" }
  | { kind: "data_failed" }
  | { kind: "slips_failed" };

interface OfflineContextValue {
  operator: OperatorInfo;
  deviceId: string | null;
  online: boolean;
  syncing: boolean;
  refreshing: boolean;
  notice: SyncNotice;
  syncNow: () => Promise<void>;
  retryFailed: () => Promise<void>;
  refreshData: () => Promise<void>;
  getSlips: () => Promise<boolean>;
  /** Sends queued slip SMS messages whose entries the server has confirmed. */
  processSms: () => Promise<void>;
}

const OfflineContext = createContext<OfflineContextValue | null>(null);

export function useOffline(): OfflineContextValue {
  const value = useContext(OfflineContext);
  if (!value) throw new Error("useOffline must be used inside OfflineProvider");
  return value;
}

const SLIPS_LOW = 30;
const REFERENCE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const AUTO_SYNC_EVERY_MS = 30_000;
const PRECACHE = ["/collect", "/procurement", "/dashboard"];

/**
 * Keeps the phone ready to work with no network, and does the housekeeping
 * whenever there is one: downloads farmers and rates, tops up slip numbers and
 * sends queued entries. Failed attempts back off, so a weak signal is not
 * hammered, and nothing here ever marks an entry synced on its own: only the
 * server's reply does that (see syncPending).
 */
export function OfflineProvider({ operator, children }: { operator: OperatorInfo; children: React.ReactNode }) {
  const online = useOnlineStatus();
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<SyncNotice>({ kind: "idle" });
  const busy = useRef(false);
  const signedOut = useRef(false);

  useEffect(() => {
    void registerServiceWorker();
    getOrCreateDeviceId(getLocalDb()).then(setDeviceId, () => undefined);
  }, []);

  const getSlips = useCallback(async (): Promise<boolean> => {
    if (!deviceId) return false;
    try {
      const response = await fetch("/api/slip-block", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId }),
      });
      if (!response.ok) throw new Error(String(response.status));
      const block = (await response.json()) as { centreCode: string; start: number; end: number };
      await setSlipBlock(getLocalDb(), block);
      return true;
    } catch {
      setNotice({ kind: "slips_failed" });
      return false;
    }
  }, [deviceId]);

  const refreshData = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await downloadReferenceData(getLocalDb());
      // A completed download proves the server answered, even with nothing to send.
      await markSyncSucceeded(getLocalDb());
      setNotice({ kind: "data_updated" });
      void precachePages(PRECACHE);
    } catch {
      setNotice({ kind: "data_failed" });
    } finally {
      setRefreshing(false);
    }
  }, [refreshing]);

  const processSms = useCallback(async () => {
    if (signedOut.current || !navigator.onLine) return;
    try {
      await processSmsQueue(getLocalDb(), { operatorId: operator.operatorId });
    } catch {
      // A failed pass leaves every message queued; the next cycle tries again.
    }
  }, [operator.operatorId]);

  const syncNow = useCallback(async () => {
    if (!deviceId || busy.current || signedOut.current) return;
    busy.current = true;
    setSyncing(true);
    try {
      const summary = await syncPending(getLocalDb(), { deviceId, operatorId: operator.operatorId });
      if (summary.stoppedBecause === "signed_out") signedOut.current = true;
      setNotice({ kind: "result", summary });
      // Messages wait for their entry to sync; now is when they can go.
      await processSms();
    } finally {
      busy.current = false;
      setSyncing(false);
    }
  }, [deviceId, operator.operatorId, processSms]);

  const retryFailed = useCallback(async () => {
    await retryFailedEntries(getLocalDb(), operator.operatorId);
    await syncNow();
  }, [operator.operatorId, syncNow]);

  /** One pass of housekeeping, safe to run as often as we like. */
  const cycle = useCallback(async () => {
    if (!deviceId || !navigator.onLine || signedOut.current) return;
    const db = getLocalDb();

    const age = await referenceDataAge(db);
    const stale = !age || Date.now() - Date.parse(age) > REFERENCE_MAX_AGE_MS || (await db.members.count()) === 0;
    if (stale && !refreshing) await refreshData();

    if ((await slipNumbersRemaining(db)) < SLIPS_LOW) await getSlips();

    // Respect backoff: skip while every queued entry is still waiting out its delay.
    const pending = await db.entries.where("syncStatus").equals("pending").toArray();
    const mine = pending.filter((e) => e.operatorId === operator.operatorId);
    if (mine.length > 0 && mine.some((e) => !e.nextRetryAt || e.nextRetryAt <= Date.now())) {
      await syncNow();
    } else {
      // Nothing to sync, but a message may still be queued or awaiting its receipt.
      await processSms();
    }
  }, [deviceId, getSlips, operator.operatorId, processSms, refreshData, refreshing, syncNow]);

  const cycleRef = useRef(cycle);
  useEffect(() => {
    cycleRef.current = cycle;
  });

  useEffect(() => {
    if (!deviceId) return;
    const run = () => void cycleRef.current();
    run();
    const timer = window.setInterval(run, AUTO_SYNC_EVERY_MS);
    window.addEventListener("online", run);
    document.addEventListener("visibilitychange", run);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", run);
      document.removeEventListener("visibilitychange", run);
    };
  }, [deviceId]);

  const value = useMemo<OfflineContextValue>(
    () => ({ operator, deviceId, online, syncing, refreshing, notice, syncNow, retryFailed, refreshData, getSlips, processSms }),
    [operator, deviceId, online, syncing, refreshing, notice, syncNow, retryFailed, refreshData, getSlips, processSms],
  );

  return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>;
}
