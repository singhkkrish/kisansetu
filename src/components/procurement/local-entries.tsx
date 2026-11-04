"use client";

import { CheckCircle2, Clock, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { SlipPanel } from "@/components/slip/slip-panel";
import { Button } from "@/components/ui/button";
import { useOffline } from "@/components/offline/offline-provider";
import { SyncStatus } from "@/components/offline/sync-status";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useLocalQuery } from "@/hooks/use-local-query";
import { formatDisplayDate, formatInr, formatKg } from "@/lib/calculations/format";
import { getLocalDb, type CachedMember, type LocalEntry } from "@/lib/db/local";
import type { Messages } from "@/lib/i18n/messages";
import { getPart4Messages } from "@/lib/i18n/part4-messages";

interface Row {
  entry: LocalEntry;
  farmerName: string;
  member: CachedMember | undefined;
}

async function load(operatorId: string): Promise<Row[]> {
  const db = getLocalDb();
  const entries = (await db.entries.orderBy("seq").reverse().toArray()).filter((e) => e.operatorId === operatorId);
  const farmers = await db.members.bulkGet([...new Set(entries.map((e) => e.farmerId))]);
  const byId = new Map(farmers.filter(Boolean).map((m) => [m!.id, m!]));
  return entries.map((entry) => ({
    entry,
    member: byId.get(entry.farmerId),
    farmerName: byId.get(entry.farmerId)?.fullName ?? entry.farmerId.slice(0, 8),
  }));
}

function time(iso: string) {
  return `${formatDisplayDate(iso)}, ${new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: true })}`;
}

/** The operator's own entries, read from this phone so they are visible offline and before they sync. */
export function LocalEntries({ t, lang = "mr" }: { t: Messages; lang?: "mr" | "en" }) {
  const { operator } = useOffline();
  const t4 = getPart4Messages(lang);
  const [openSlip, setOpenSlip] = useState<string | null>(null);
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
          {rows.map(({ entry: e, farmerName, member }) => (
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
                      <dt className="text-muted">{p.rate}</dt>
                      <dd data-testid={`rate-${e.slipNo}`}>
                        {formatInr(e.ratePerQuintal)}
                        {e.rateDate ? ` · ${formatDisplayDate(`${e.rateDate}T06:30:00Z`)}` : ""}
                        {e.rateVersion ? ` · ${t4.wizardPrice.version} ${e.rateVersion}` : ""}
                      </dd>
                    </div>
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
                  <div className="flex flex-wrap items-center gap-4">
                    <Button size="sm" variant="secondary" onClick={() => setOpenSlip(openSlip === e.clientId ? null : e.clientId)} aria-expanded={openSlip === e.clientId} data-testid={`slip-toggle-${e.slipNo}`}>
                      {openSlip === e.clientId ? t4.slip.hide : t4.slip.show}
                    </Button>
                    {e.syncStatus === "synced" && (
                      <Link href={`/procurement/${e.clientId}`} className="text-sm font-semibold text-primary underline">{p.detailTitle}</Link>
                    )}
                  </div>
                  {openSlip === e.clientId && <SlipPanel entry={e} member={member} t={t4} />}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
