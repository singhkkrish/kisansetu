"use client";

import { CheckCircle2, Clock, WifiOff } from "lucide-react";
import { useOffline } from "@/components/offline/offline-provider";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLocalQuery } from "@/hooks/use-local-query";
import { formatDisplayDate, formatInr } from "@/lib/calculations/format";
import type { CachedPrice } from "@/lib/db/local";
import { getLocalDb } from "@/lib/db/local";
import type { Messages } from "@/lib/i18n/messages";
import type { Part4Messages } from "@/lib/i18n/part4-messages";
import { businessDate } from "@/lib/offline/clock";
import { listCachedRates, referenceDataAge } from "@/lib/offline/reference-data";

/** A phone's copy of the rates is "old" after this long without a download. */
export const PRICE_COPY_MAX_AGE_MS = 6 * 60 * 60 * 1000;

export type PriceSyncState = "none" | "offline" | "stale" | "synced";

/**
 * How trustworthy the rates on this phone are right now. Never "synced" unless
 * the phone is online and downloaded them recently: otherwise it says it is
 * working from its saved copy.
 */
export function priceSyncState(input: { hasRates: boolean; online: boolean; downloadedAt: string | null; now?: number }): PriceSyncState {
  if (!input.hasRates) return "none";
  if (!input.online) return "offline";
  const age = input.downloadedAt ? (input.now ?? Date.now()) - Date.parse(input.downloadedAt) : Infinity;
  return age > PRICE_COPY_MAX_AGE_MS ? "stale" : "synced";
}

interface Snapshot {
  date: string;
  rows: CachedPrice[];
  downloadedAt: string | null;
}

export function usePriceSnapshot(): Snapshot | null {
  return useLocalQuery<Snapshot | null>(async () => {
    const db = getLocalDb();
    const date = await businessDate(db);
    return { date, rows: await listCachedRates(db, date), downloadedAt: await referenceDataAge(db) };
  }, null);
}

function time(iso: string) {
  return new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: true }).toUpperCase();
}

export function PriceSyncBadge({ state, t }: { state: PriceSyncState; t: Part4Messages["priceStatus"] }) {
  if (state === "none") return null;
  if (state === "synced") return <Badge tone="success"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />{t.synced}</Badge>;
  if (state === "offline") return <Badge tone="warn"><WifiOff className="h-3.5 w-3.5" aria-hidden="true" />{t.offlineCopy}</Badge>;
  return <Badge tone="warn"><Clock className="h-3.5 w-3.5" aria-hidden="true" />{t.stale}</Badge>;
}

/** Dashboard card for operators: the rates this phone will use, their effective date and version, and how fresh they are. */
export function PriceStatusCard({ t, t4, crops }: { t: Messages; t4: Part4Messages; crops: Messages["crops"] }) {
  const { online } = useOffline();
  const snap = usePriceSnapshot();
  const p = t4.priceStatus;
  const state = snap ? priceSyncState({ hasRates: snap.rows.length > 0, online, downloadedAt: snap.downloadedAt }) : "none";
  const rows = [...(snap?.rows ?? [])].sort((a, b) => a.crop.localeCompare(b.crop) || a.grade.localeCompare(b.grade));

  return (
    <Card data-testid="price-status">
      <CardHeader>
        <CardTitle>{p.title}</CardTitle>
        {snap && <p className="mt-1 text-sm text-muted">{p.effective}: <span className="font-semibold text-ink" data-testid="price-effective">{formatDisplayDate(`${snap.date}T06:30:00Z`)}</span></p>}
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.length === 0 ? (
          <p className="text-muted">{p.none}</p>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={`${r.crop}-${r.grade}`} className="flex items-baseline justify-between py-3">
                <span className="text-base font-semibold">
                  {crops[r.crop]} <span className="font-normal text-muted">{t.dashboard.grade} {r.grade}</span>
                  {r.version ? <span className="ml-2 text-xs font-normal text-muted">{p.version} {r.version}</span> : null}
                </span>
                <span className="text-2xl font-bold tabular-nums">{formatInr(r.ratePerQuintal)}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="space-y-1" data-testid="price-sync" data-state={state}>
          <PriceSyncBadge state={state} t={p} />
          <p className="text-xs text-muted">
            {snap?.downloadedAt ? `${p.downloadedAt}: ${time(snap.downloadedAt)}` : p.neverDownloaded}
          </p>
          <p className="text-xs text-muted">{p.newerNote}</p>
        </div>
      </CardContent>
    </Card>
  );
}
