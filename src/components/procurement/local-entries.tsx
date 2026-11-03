"use client";

import { CheckCircle2, Clock, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useOffline } from "@/components/offline/offline-provider";
import { SyncStatus } from "@/components/offline/sync-status";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useLocalQuery } from "@/hooks/use-local-query";
import { formatDisplayDate, formatInr, formatKg } from "@/lib/calculations/format";
import { getLocalDb, type LocalEntry } from "@/lib/db/local";
import type { Messages } from "@/lib/i18n/messages";

interface Row {
  entry: LocalEntry;
  farmerName: string;
}

async function load(operatorId: string): Promise<Row[]> {
  const db = getLocalDb();
  const entries = (await db.entries.orderBy("seq").reverse().toArray()).filter((e) => e.operatorId === operatorId);
  const farmers = await db.members.bulkGet([...new Set(entries.map((e) => e.farmerId))]);
  const names = new Map(farmers.filter(Boolean).map((m) => [m!.id, m!.fullName]));
  return entries.map((entry) => ({ entry, farmerName: names.get(entry.farmerId) ?? entry.farmerId.slice(0, 8) }));
}

function time(iso: string) {
  return `${formatDisplayDate(iso)}, ${new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: true })}`;
}

/** The operator's own entries, read from this phone so they are visible offline and before they sync. */
export function LocalEntries({ t }: { t: Messages }) {
  const { operator } = useOffline();
  const rows = useLocalQuery(() => load(operator.operatorId), null as Row[] | null);
  const p = t.procurement;

  return (
    <div className="space-y-6">
      <SyncStatus t={t.sync} />
      <h2 className="text-xl font-bold">{p.mine}</h2>
      {rows === null ? null : rows.length === 0 ? (
        <p className="text-muted">{p.empty}</p>
      ) : (
        <ul className="space-y-3" data-testid="local-entries">
          {rows.map(({ entry: e, farmerName }) => (
            <li key={e.clientId}>
              <Card>
                <CardContent className="space-y-3 pt-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-lg font-bold">{e.slipNo}</p>
                      <p className="text-base">{farmerName} · {t.crops[e.crop]} {e.grade}</p>
                    </div>
                    <Badge
                      data-testid={`status-${e.slipNo}`}
                      tone={e.syncStatus === "synced" ? (e.flagged ? "warn" : "success") : e.syncStatus === "rejected" ? "danger" : "warn"}
                    >
                      {e.syncStatus === "synced" ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> : e.syncStatus === "rejected" ? <TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" /> : <Clock className="h-3.5 w-3.5" aria-hidden="true" />}
                      {p.syncState[e.syncStatus]}
                    </Badge>
                  </div>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                    <div><dt className="text-muted">{p.net}</dt><dd className="text-base font-semibold tabular-nums">{formatKg(e.netKg)} kg</dd></div>
                    <div><dt className="text-muted">{p.amount}</dt><dd className="text-base font-semibold tabular-nums">{formatInr(e.amount)}</dd></div>
                    <div className="col-span-2">
                      <dt className="text-muted">{p.deviceTime}</dt>
                      <dd>{time(e.deviceRecordedAt)}</dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="text-muted">{p.serverTime}</dt>
                      <dd>{e.serverReceivedAt ? time(e.serverReceivedAt) : p.notYetOnServer}</dd>
                    </div>
                  </dl>
                  {e.syncStatus === "rejected" && e.lastError && <p className="text-sm font-semibold text-danger">{e.lastError}</p>}
                  {e.syncStatus === "synced" && (
                    <Link href={`/procurement/${e.clientId}`} className="text-sm font-semibold text-primary underline">{p.detailTitle}</Link>
                  )}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
