import type { Metadata } from "next";
import { BackLink } from "@/components/members/back-link";
import { DispatchForm } from "@/components/stock/dispatch-form";
import { Badge } from "@/components/ui/badge";
import { Notice } from "@/components/ui/notice";
import { requirePermission } from "@/lib/auth/page-guard";
import { formatDisplayDate, formatKg, istDate } from "@/lib/calculations/format";
import { getMessages } from "@/lib/i18n/messages";
import { getPart5Messages } from "@/lib/i18n/part5-messages";
import { listDispatches, loadStock } from "@/lib/services/stock";
import { weightLoss } from "@/lib/stock/stock";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Stock dispatch" };

function stamp(iso: string) {
  const time = new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: true }).toUpperCase();
  return `${formatDisplayDate(iso)}, ${time}`;
}

export default async function DispatchPage() {
  const session = await requirePermission("dispatch:write");
  const lang = session.profile.preferred_lang;
  const t = getMessages(lang);
  const p5 = getPart5Messages(lang);
  const d = p5.dispatch;
  const supabase = await createClient();

  const [{ data: centres }, stock, history] = await Promise.all([
    supabase.from("centres").select("id, code, name").eq("active", true).order("code"),
    loadStock(supabase, { date: istDate(new Date().toISOString()), centreId: null, crop: null }),
    listDispatches(supabase, { centreId: null, crop: null }),
  ]);

  const stockByKey: Record<string, string> = {};
  for (const r of stock.view?.rows ?? []) {
    stockByKey[`${r.centreId}|${r.crop}`] = (Number(r.procuredKg) - Number(r.dispatchedBookKg)).toFixed(1);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <BackLink href="/stock" label={d.back} />
      <div>
        <h1 className="text-2xl font-bold">{d.title}</h1>
        <p className="mt-1 text-sm text-muted">{d.intro}</p>
      </div>

      {stock.error ? (
        <Notice tone="error">{d.failed}</Notice>
      ) : (
        <DispatchForm
          centres={(centres ?? []).map((c) => ({ id: c.id as string, code: c.code as string, name: c.name as string }))}
          stock={stockByKey}
          crops={t.crops}
          t={d}
        />
      )}

      <section className="space-y-3" aria-labelledby="history-title">
        <h2 id="history-title" className="text-lg font-bold">{d.history}</h2>
        {history.error ? (
          <Notice tone="error">{d.failed}</Notice>
        ) : history.items.length === 0 ? (
          <p className="text-muted">{d.empty}</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-line bg-surface">
            <table className="w-full min-w-[60rem] text-left text-sm" data-testid="dispatch-history">
              <thead className="border-b border-line text-muted">
                <tr>
                  {[d.no, d.time, d.centre, d.crop, d.truck, d.to, d.before, d.bookQty, d.weighed, d.lossCol, d.after].map((c) => (
                    <th key={c} scope="col" className="px-3 py-2.5 font-semibold">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {history.items.map((i) => {
                  const loss = weightLoss(i.bookKg, i.weightKg);
                  return (
                    <tr key={i.id} data-testid={`dispatch-${i.dispatchNo}`}>
                      <td className="px-3 py-2.5 font-semibold">{i.dispatchNo}</td>
                      <td className="px-3 py-2.5">{stamp(i.dispatchedAt)}<span className="block text-xs text-muted">{i.createdByName ?? "—"}</span></td>
                      <td className="px-3 py-2.5">{i.centreCode}</td>
                      <td className="px-3 py-2.5">{t.crops[i.crop]}</td>
                      <td className="px-3 py-2.5 font-mono">{i.truckNo}</td>
                      <td className="px-3 py-2.5">{i.destination}</td>
                      <td className="px-3 py-2.5 tabular-nums">{formatKg(i.stockBeforeKg)}</td>
                      <td className="px-3 py-2.5 tabular-nums">{formatKg(i.bookKg)}</td>
                      <td className="px-3 py-2.5 tabular-nums">{formatKg(i.weightKg)}</td>
                      <td className="px-3 py-2.5 tabular-nums" data-testid="row-loss">{formatKg(loss.lossKg)} · {loss.lossPct}%{loss.high && <Badge tone="warn" className="ml-1">{p5.stock.lossHigh}</Badge>}</td>
                      <td className="px-3 py-2.5 font-semibold tabular-nums">{formatKg(i.stockAfterKg)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-sm text-muted">{d.immutable}</p>
      </section>
    </div>
  );
}
