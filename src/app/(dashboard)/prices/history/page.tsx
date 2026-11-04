import type { Metadata } from "next";
import Link from "next/link";
import { BackLink } from "@/components/members/back-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { Select } from "@/components/ui/select";
import { requirePermission } from "@/lib/auth/page-guard";
import { formatDisplayDate, formatInr } from "@/lib/calculations/format";
import { getMessages } from "@/lib/i18n/messages";
import { getPart4Messages } from "@/lib/i18n/part4-messages";
import { HISTORY_LIMIT, listPriceAudit, listPriceVersions } from "@/lib/services/prices";
import { createClient } from "@/lib/supabase/server";
import { CROPS, type Crop } from "@/types/domain";

export const metadata: Metadata = { title: "Price history" };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function stamp(iso: string) {
  const time = new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: true }).toUpperCase();
  return `${formatDisplayDate(iso)}, ${time}`;
}

export default async function PriceHistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requirePermission("prices:write");
  const lang = session.profile.preferred_lang;
  const t = getMessages(lang);
  const h = getPart4Messages(lang).history;

  const params = await searchParams;
  const pick = (k: string) => (typeof params[k] === "string" ? (params[k] as string) : "");
  const from = DATE.test(pick("from")) ? pick("from") : "";
  const to = DATE.test(pick("to")) ? pick("to") : "";
  const crop = (CROPS as readonly string[]).includes(pick("crop")) ? (pick("crop") as Crop) : "";
  const filtered = Boolean(from || to || crop);

  const supabase = await createClient();
  const { items, error } = await listPriceVersions(supabase, { from, to, crop });
  const audit = error ? [] : await listPriceAudit(supabase, items.map((i) => i.id));

  const tone = { draft: "warn", published: "success", superseded: "neutral" } as const;

  return (
    <div className="space-y-6">
      <BackLink href="/prices" label={h.backToBoard} />
      <div>
        <h1 className="text-2xl font-bold">{h.title}</h1>
        <p className="mt-1 text-sm text-muted">{h.intro}</p>
      </div>

      <form method="get" action="/prices/history" className="grid grid-cols-2 gap-3 rounded-xl border border-line bg-surface p-4 sm:grid-cols-4">
        <div>
          <Label htmlFor="from">{h.from}</Label>
          <Input id="from" name="from" type="date" defaultValue={from} />
        </div>
        <div>
          <Label htmlFor="to">{h.to}</Label>
          <Input id="to" name="to" type="date" defaultValue={to} />
        </div>
        <div className="col-span-2 sm:col-span-1">
          <Label htmlFor="crop">{h.crop}</Label>
          <Select id="crop" name="crop" defaultValue={crop}>
            <option value="">{h.allCrops}</option>
            {CROPS.map((c) => <option key={c} value={c}>{t.crops[c]}</option>)}
          </Select>
        </div>
        <div className="col-span-2 flex items-end gap-2 sm:col-span-1">
          <Button type="submit" className="flex-1">{h.apply}</Button>
          {filtered && <Button asChild variant="ghost"><Link href="/prices/history">{h.clear}</Link></Button>}
        </div>
      </form>

      {error ? (
        <Notice tone="error">{h.error}</Notice>
      ) : items.length === 0 ? (
        <p className="text-muted">{h.empty}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full min-w-[56rem] text-left text-sm" data-testid="price-history">
            <thead className="bg-primary-soft text-xs uppercase tracking-wide text-muted">
              <tr>
                {[h.date, h.crop, h.rate, "v", h.status, h.createdBy, h.publishedBy, h.publishedAt].map((c) => (
                  <th key={c} scope="col" className="px-3 py-2.5 font-semibold">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {items.map((v) => {
                const trail = audit.filter((a) => a.versionId === v.id);
                return (
                  <tr key={v.id} className="align-top" data-testid={`history-${v.crop}-${v.grade}-v${v.version}`}>
                    <td className="px-3 py-3 font-semibold tabular-nums">{formatDisplayDate(`${v.priceDate}T06:30:00Z`)}</td>
                    <td className="px-3 py-3">{t.crops[v.crop]} · {v.grade}</td>
                    <td className="px-3 py-3 font-bold tabular-nums">{formatInr(v.rate)}</td>
                    <td className="px-3 py-3 tabular-nums">{v.version}</td>
                    <td className="px-3 py-3"><Badge tone={tone[v.status]}>{h.statusLabels[v.status]}</Badge></td>
                    <td className="px-3 py-3">{v.createdByName ?? "—"}<span className="block text-xs text-muted">{stamp(v.createdAt)}</span></td>
                    <td className="px-3 py-3">{v.publishedByName ?? "—"}</td>
                    <td className="px-3 py-3">
                      {v.publishedAt ? stamp(v.publishedAt) : "—"}
                      {v.correctionReason && <span className="mt-1 block text-xs text-muted">{h.reason}: {v.correctionReason}</span>}
                      {trail.length > 0 && (
                        <details className="mt-1">
                          <summary className="cursor-pointer text-xs font-semibold text-primary">{h.audit} ({trail.length})</summary>
                          <ol className="mt-1 space-y-1 text-xs text-muted">
                            {trail.map((a) => (
                              <li key={a.id}>
                                {h.actions[a.action as keyof typeof h.actions] ?? a.action} · {stamp(a.at)}{a.actorName ? ` · ${a.actorName}` : ""}
                              </li>
                            ))}
                          </ol>
                        </details>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {items.length >= HISTORY_LIMIT && <p className="text-sm text-muted">{h.limit}</p>}
    </div>
  );
}
