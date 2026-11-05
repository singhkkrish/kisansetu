import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { Select } from "@/components/ui/select";
import { requirePermission } from "@/lib/auth/page-guard";
import { formatInr, formatKg, istDate } from "@/lib/calculations/format";
import { getMessages } from "@/lib/i18n/messages";
import { getPart5Messages } from "@/lib/i18n/part5-messages";
import { loadStock } from "@/lib/services/stock";
import { createClient } from "@/lib/supabase/server";
import { CROPS, type Crop } from "@/types/domain";

export const metadata: Metadata = { title: "Stock dashboard" };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Tile({ label, value, sub, testId, tone }: { label: string; value: string; sub?: string; testId: string; tone?: "danger" | "warn" }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <dt className="text-sm text-muted">{label}</dt>
        <dd className={`mt-1 text-3xl font-bold tabular-nums ${tone === "danger" ? "text-danger" : tone === "warn" ? "text-warn" : ""}`} data-testid={testId}>{value}</dd>
        {sub && <p className="mt-1 text-xs text-muted">{sub}</p>}
      </CardContent>
    </Card>
  );
}

export default async function StockPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requirePermission("stock:read");
  const lang = session.profile.preferred_lang;
  const t = getMessages(lang);
  const s = getPart5Messages(lang).stock;

  const params = await searchParams;
  const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");
  const today = istDate(new Date().toISOString());
  const date = DATE.test(str(params.date)) ? str(params.date) : today;
  const centreId = UUID.test(str(params.centre)) ? str(params.centre) : null;
  const crop = (CROPS as readonly string[]).includes(str(params.crop)) ? (str(params.crop) as Crop) : null;

  const supabase = await createClient();
  const [{ view, error }, { data: centres }] = await Promise.all([
    loadStock(supabase, { date, centreId, crop }),
    supabase.from("centres").select("id, code, name").order("code"),
  ]);
  const centreName = new Map((centres ?? []).map((c) => [c.id as string, `${c.code as string} · ${c.name as string}`]));
  const sm = view?.summary;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{s.title}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">{s.intro}</p>
        </div>
        <Button asChild><Link href="/stock/dispatch" data-testid="to-dispatch">{s.dispatchLink}</Link></Button>
      </div>

      <form method="get" action="/stock" className="flex flex-wrap items-end gap-3 rounded-xl border border-line bg-surface p-4">
        <div>
          <Label htmlFor="date">{s.date}</Label>
          <Input id="date" name="date" type="date" defaultValue={date} max={today} className="w-48" data-testid="stock-date" />
        </div>
        <div className="min-w-48">
          <Label htmlFor="centre">{s.centre}</Label>
          <Select id="centre" name="centre" defaultValue={centreId ?? ""} data-testid="stock-centre">
            <option value="">{s.allCentres}</option>
            {(centres ?? []).map((c) => <option key={c.id as string} value={c.id as string}>{c.code as string} · {c.name as string}</option>)}
          </Select>
        </div>
        <div className="min-w-40">
          <Label htmlFor="crop">{s.crop}</Label>
          <Select id="crop" name="crop" defaultValue={crop ?? ""} data-testid="stock-crop">
            <option value="">{s.allCrops}</option>
            {CROPS.map((c) => <option key={c} value={c}>{t.crops[c]}</option>)}
          </Select>
        </div>
        <Button type="submit" variant="secondary" data-testid="stock-apply">{s.apply}</Button>
      </form>

      {error || !view || !sm ? (
        <Notice tone="error">{s.loadError}</Notice>
      ) : (
        <>
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tile label={s.totalWeight} value={`${formatKg(sm.totalProcuredKg)} ${s.kg}`} testId="tile-total" />
            <Tile label={s.soybean} value={`${formatKg(sm.byCrop.soybean.stockKg)} ${s.kg}`} testId="tile-soybean" />
            <Tile label={s.tur} value={`${formatKg(sm.byCrop.tur.stockKg)} ${s.kg}`} testId="tile-tur" />
            <Tile label={s.today} value={`${formatKg(sm.todayKg)} ${s.kg}`} testId="tile-today" />
            <Tile label={s.pendingApprovals} value={String(sm.pendingApprovals)} testId="tile-approvals" tone={sm.pendingApprovals > 0 ? "warn" : undefined} />
            <Tile label={s.pendingPayments} value={formatInr(sm.pendingPayments.amount)} sub={`${sm.pendingPayments.count}`} testId="tile-pending-pay" />
            <Tile label={s.failedPayments} value={String(sm.failedPayments.count)} sub={formatInr(sm.failedPayments.amount)} testId="tile-failed-pay" tone={sm.failedPayments.count > 0 ? "danger" : undefined} />
            <Tile label={s.unsynced} value={String(view.unsynced)} sub={s.unsyncedNote} testId="tile-unsynced" tone={view.unsynced > 0 ? "warn" : undefined} />
          </dl>

          <div className="flex flex-wrap gap-4 text-sm font-semibold">
            <Link href="/procurement?status=held" className="text-primary underline">{s.reviewLink}</Link>
            <Link href="/payments" className="text-primary underline">{s.paymentsLink}</Link>
          </div>

          <Card>
            <CardHeader><CardTitle>{s.byCentre}</CardTitle></CardHeader>
            <CardContent>
              {sm.byCentre.length === 0 || sm.byCentre.every((c) => Number(c.procuredKg) === 0) ? (
                <p className="text-muted">{s.empty}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[36rem] text-left text-base" data-testid="centre-stock">
                    <thead className="border-b border-line text-sm text-muted">
                      <tr>
                        <th scope="col" className="py-2 pr-4 font-semibold">{s.centre2}</th>
                        <th scope="col" className="px-4 py-2 text-right font-semibold">{t.crops.soybean}</th>
                        <th scope="col" className="px-4 py-2 text-right font-semibold">{t.crops.tur}</th>
                        <th scope="col" className="px-4 py-2 text-right font-semibold">{s.stock}</th>
                        <th scope="col" className="py-2 pl-4 text-right font-semibold">{s.procured}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {sm.byCentre.filter((c) => Number(c.procuredKg) > 0).map((c) => (
                        <tr key={c.centreId} data-testid={`stock-row-${(centreName.get(c.centreId) ?? c.centreId).slice(0, 3)}`}>
                          <td className="py-2.5 pr-4 font-semibold">{centreName.get(c.centreId) ?? c.centreId}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums">{formatKg(c.byCrop.soybean)}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums">{formatKg(c.byCrop.tur)}</td>
                          <td className="px-4 py-2.5 text-right font-bold tabular-nums">{formatKg(c.stockKg)}</td>
                          <td className="py-2.5 pl-4 text-right tabular-nums text-muted">{formatKg(c.procuredKg)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>{s.loss}</CardTitle></CardHeader>
            <CardContent>
              <p className="text-sm text-muted">{s.lossNote}</p>
              <p className="mt-2 text-2xl font-bold tabular-nums" data-testid="loss-total">
                {formatKg(sm.weightLoss.lossKg)} {s.kg} · {sm.weightLoss.lossPct}%
                {sm.weightLoss.high && <Badge tone="warn" className="ml-2">{s.lossHigh}</Badge>}
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
