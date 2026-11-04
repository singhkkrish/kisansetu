"use client";

import { useOffline } from "@/components/offline/offline-provider";
import { PriceSyncBadge, priceSyncState, usePriceSnapshot } from "@/components/prices/price-status";
import { formatDisplayDate } from "@/lib/calculations/format";
import type { CachedPrice } from "@/lib/db/local";
import type { Part4Messages } from "@/lib/i18n/part4-messages";

/** One line under a rate: its effective date, version, and whether this phone's copy is fresh. */
export function PriceStatusLine({ price, t }: { price: CachedPrice | null; t: Part4Messages["wizardPrice"] & { sync: Part4Messages["priceStatus"] } }) {
  const { online } = useOffline();
  const snap = usePriceSnapshot();
  if (!price) return null;
  const state = priceSyncState({ hasRates: true, online, downloadedAt: snap?.downloadedAt ?? null });

  return (
    <div className="space-y-1" data-testid="rate-status">
      <p className="text-sm text-muted">
        {t.effective}: <span className="font-semibold text-ink" data-testid="rate-effective">{formatDisplayDate(`${price.priceDate}T06:30:00Z`)}</span>
        {price.version ? <> · {t.version} <span className="font-semibold text-ink" data-testid="rate-version">{price.version}</span></> : null}
      </p>
      <PriceSyncBadge state={state} t={t.sync} />
    </div>
  );
}
