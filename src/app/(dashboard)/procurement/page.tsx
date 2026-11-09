import type { Metadata } from "next";
import Link from "next/link";
import { ApprovalBadge, PaymentBadge } from "@/components/procurement/status-badges";
import { LocalEntries } from "@/components/procurement/local-entries";
import { ReviewActions } from "@/components/review/review-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { Select } from "@/components/ui/select";
import { can } from "@/lib/auth/permissions";
import { requireAnyPermission } from "@/lib/auth/page-guard";
import { formatDisplayDate, formatInr, formatKg } from "@/lib/calculations/format";
import { getMessages } from "@/lib/i18n/messages";
import { getPart5Messages } from "@/lib/i18n/part5-messages";
import { LIST_LIMIT, listEntries, parseApprovalFilter } from "@/lib/services/procurement-view";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Procurement entries" };

export default async function ProcurementPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireAnyPermission("procurement:read_own_centre", "procurement:read_all");
  const t = getMessages(session.profile.preferred_lang);
  const p = t.procurement;

  // Operators see their own entries from the phone itself, so the list works offline
  // and shows entries that have not reached the server yet.
  if (session && !can(session.profile.role, "procurement:read_all")) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">{p.title}</h1>
        <LocalEntries t={t} lang={session.profile.preferred_lang} />
      </div>
    );
  }

  // Office manager: the review queue.
  const r = getPart5Messages(session.profile.preferred_lang).review;
  const params = await searchParams;
  const filter = parseApprovalFilter(params.status);
  const centreParam = typeof params.centre === "string" && /^[0-9a-f-]{36}$/i.test(params.centre) ? params.centre : "";
  const anomaliesOnly = params.flagged === "1";
  const supabase = await createClient();
  const [{ items, error }, { data: centres }] = await Promise.all([
    listEntries(supabase, filter, { centreId: centreParam || null, anomaliesOnly }),
    supabase.from("centres").select("id, code, name").order("code"),
  ]);
  const keep = (status: string) => {
    const q = new URLSearchParams();
    if (status !== "all") q.set("status", status);
    if (centreParam) q.set("centre", centreParam);
    if (anomaliesOnly) q.set("flagged", "1");
    const text = q.toString();
    return text ? `/procurement?${text}` : "/procurement";
  };
  const filters = [
    ["all", p.filterAll],
    ["held", p.filterHeld],
    ["approved", p.filterApproved],
    ["rejected", p.filterRejected],
  ] as const;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{r.title}</h1>
        <p className="mt-1 text-sm text-muted">{r.intro}</p>
      </div>

      <form method="get" action="/procurement" className="flex flex-wrap items-end gap-3 rounded-xl border border-line bg-surface p-4">
        {filter !== "all" && <input type="hidden" name="status" value={filter} />}
        <div className="min-w-48">
          <label htmlFor="centre" className="mb-1.5 block text-sm font-semibold">{r.centre}</label>
          <Select id="centre" name="centre" defaultValue={centreParam}>
            <option value="">{r.allCentres}</option>
            {(centres ?? []).map((c) => <option key={c.id as string} value={c.id as string}>{c.code as string} · {c.name as string}</option>)}
          </Select>
        </div>
        <label className="flex h-12 items-center gap-2 text-base font-semibold">
          <input type="checkbox" name="flagged" value="1" defaultChecked={anomaliesOnly} className="h-5 w-5 accent-[var(--primary)]" />
          {r.anomaliesOnly}
        </label>
        <Button type="submit" variant="secondary">{r.apply}</Button>
        {(centreParam || anomaliesOnly) && <Button asChild variant="ghost"><Link href={filter === "all" ? "/procurement" : `/procurement?status=${filter}`}>{r.clear}</Link></Button>}
      </form>

      <nav aria-label={p.status} className="flex flex-wrap gap-2">
        {filters.map(([value, label]) => (
          <Link
            key={value}
            href={keep(value)}
            aria-current={filter === value ? "page" : undefined}
            className={`inline-flex h-11 items-center rounded-lg border px-4 text-base font-semibold ${filter === value ? "border-primary bg-primary-soft text-primary" : "border-line bg-surface"}`}
          >
            {label}
          </Link>
        ))}
      </nav>

      {error ? (
        <Notice tone="error">{p.loadError}</Notice>
      ) : items.length === 0 ? (
        <p className="text-muted">{filter === "all" ? p.empty : p.emptyHeld}</p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-line bg-surface">
            <table className="w-full min-w-[72rem] text-left text-base" data-testid="entries-table">
              <thead className="border-b border-line text-sm text-muted">
                <tr>
                  <th className="px-4 py-3 font-semibold">{p.slip}</th>
                  <th className="px-4 py-3 font-semibold">{p.farmer}</th>
                  <th className="px-4 py-3 font-semibold">{r.centre}</th>
                  <th className="px-4 py-3 font-semibold">{p.crop}</th>
                  <th className="px-4 py-3 text-right font-semibold">{p.net}</th>
                  <th className="px-4 py-3 text-right font-semibold">{p.amount}</th>
                  <th className="px-4 py-3 font-semibold">{r.sync}</th>
                  <th className="px-4 py-3 font-semibold">{r.anomaly}</th>
                  <th className="px-4 py-3 font-semibold">{p.approval}</th>
                  <th className="px-4 py-3 font-semibold">{p.payment}</th>
                  <th className="px-4 py-3 font-semibold">{r.actions}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {items.map((e) => (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap px-4 py-3 font-semibold">
                      <Link href={`/procurement/${e.id}`} className="text-primary underline">{e.slipNo}</Link>
                    </td>
                    <td className="px-4 py-3">{e.farmerName}<span className="block text-xs text-muted">{e.farmerCode}</span></td>
                    <td className="px-4 py-3">{e.centreCode}<span className="block text-xs text-muted">{e.centreName}</span></td>
                    <td className="px-4 py-3">{t.crops[e.crop]}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatKg(e.netKg)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatInr(e.amount)}</td>
                    <td className="px-4 py-3"><Badge tone={e.syncStatus === "synced" ? "success" : "warn"}>{r.syncState[e.syncStatus] ?? e.syncStatus}</Badge></td>
                    <td className="px-4 py-3 text-sm" data-testid={`anomaly-${e.slipNo}`}>
                      {e.flagReasons.length === 0 ? (
                        <span className="text-muted">{r.anomalyNone}</span>
                      ) : (
                        <ul className="space-y-1">
                          {e.flagReasons.map((f) => <li key={f}><Badge tone="warn">{p.flagLabels[f] ?? f}</Badge></li>)}
                        </ul>
                      )}
                    </td>
                    <td className="px-4 py-3"><ApprovalBadge status={e.approvalStatus} t={p} /><span className="mt-1 block text-xs text-muted">{formatDisplayDate(e.receivedAt)}</span></td>
                    <td className="px-4 py-3"><PaymentBadge status={e.paymentStatus} t={p} /></td>
                    <td className="px-4 py-3">
                      <ReviewActions entryId={e.id} slipNo={e.slipNo} approvalStatus={e.approvalStatus} paymentStatus={e.paymentStatus} flagged={e.flagCount > 0} t={r} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {items.length === LIST_LIMIT && <p className="text-sm text-muted">{p.showing} {LIST_LIMIT}</p>}
        </>
      )}
    </div>
  );
}
