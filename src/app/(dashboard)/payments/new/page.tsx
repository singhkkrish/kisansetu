import type { Metadata } from "next";
import { BackLink } from "@/components/members/back-link";
import { GenerateRunButton } from "@/components/payments/generate-run-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { requirePermission } from "@/lib/auth/page-guard";
import { formatInr, istDate } from "@/lib/calculations/format";
import { getPart5Messages } from "@/lib/i18n/part5-messages";
import { previewPayment } from "@/lib/services/payments";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "New payment run" };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function NewPaymentRunPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requirePermission("payment_runs:create");
  const t = getPart5Messages(session.profile.preferred_lang).payments;
  const n = t.new;

  const params = await searchParams;
  const today = istDate(new Date().toISOString());
  const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");
  const from = DATE.test(str(params.from)) ? str(params.from) : today;
  const to = DATE.test(str(params.to)) ? str(params.to) : today;
  const asked = params.show === "1";
  const chosen = [params.centre].flat().filter((c): c is string => typeof c === "string" && UUID.test(c));

  const supabase = await createClient();
  const { data: centres } = await supabase.from("centres").select("id, code, name").eq("active", true).order("code");
  const preview = asked && chosen.length > 0 && to >= from
    ? await previewPayment(supabase, { from, to, centreIds: chosen })
    : null;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <BackLink href="/payments" label={t.detail.back} />
      <h1 className="text-2xl font-bold">{n.title}</h1>

      <form method="get" action="/payments/new" className="space-y-4 rounded-xl border border-line bg-surface p-4">
        <h2 className="text-lg font-bold">{n.step1}</h2>
        <input type="hidden" name="show" value="1" />
        <div className="flex flex-wrap gap-4">
          <div>
            <Label htmlFor="from">{n.from}</Label>
            <Input id="from" name="from" type="date" defaultValue={from} className="w-48" data-testid="run-from" />
          </div>
          <div>
            <Label htmlFor="to">{n.to}</Label>
            <Input id="to" name="to" type="date" defaultValue={to} className="w-48" data-testid="run-to" />
          </div>
        </div>
        <fieldset>
          <legend className="mb-2 text-sm font-semibold">{n.centres}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {(centres ?? []).map((c) => (
              <label key={c.id as string} className="flex min-h-11 items-center gap-3 rounded-lg border border-line px-3 text-base">
                <input type="checkbox" name="centre" value={c.id as string} defaultChecked={chosen.includes(c.id as string)} className="h-5 w-5 accent-[var(--primary)]" data-testid={`centre-${c.code as string}`} />
                {c.code as string} · {c.name as string}
              </label>
            ))}
          </div>
        </fieldset>
        {asked && chosen.length === 0 && <p role="alert" className="text-sm font-semibold text-danger">{n.pickCentre}</p>}
        {asked && to < from && <p role="alert" className="text-sm font-semibold text-danger">{t.detail.failed}</p>}
        <Button type="submit" variant="secondary" data-testid="show-entries">{n.showEntries}</Button>
      </form>

      {preview && (
        <section className="space-y-4" aria-labelledby="review-title">
          <h2 id="review-title" className="text-lg font-bold">{n.step2}</h2>
          {preview.error ? (
            <Notice tone="error">{t.loadError}</Notice>
          ) : preview.preview.groups.length === 0 && preview.preview.blocked.length === 0 ? (
            <p className="text-muted" data-testid="no-entries">{n.nothing}</p>
          ) : (
            <>
              {preview.truncated && <Notice tone="warn">{n.truncated}</Notice>}
              <dl className="grid gap-3 sm:grid-cols-3" data-testid="preview-totals">
                <Card><CardContent className="pt-4"><dt className="text-sm text-muted">{n.farmers}</dt><dd className="text-3xl font-bold tabular-nums">{preview.preview.payable.farmers}</dd></CardContent></Card>
                <Card><CardContent className="pt-4"><dt className="text-sm text-muted">{n.entries}</dt><dd className="text-3xl font-bold tabular-nums">{preview.preview.payable.entries}</dd></CardContent></Card>
                <Card><CardContent className="pt-4"><dt className="text-sm text-muted">{n.total}</dt><dd className="text-3xl font-bold tabular-nums" data-testid="preview-total">{formatInr(preview.preview.payable.amount)}</dd></CardContent></Card>
              </dl>

              {preview.preview.groups.length > 0 && (
                <div className="overflow-x-auto rounded-xl border border-line bg-surface">
                  <table className="w-full min-w-[44rem] text-left text-base" data-testid="preview-table">
                    <thead className="border-b border-line text-sm text-muted">
                      <tr>
                        {[t.table.farmerId, t.table.farmer, t.table.account, t.table.ifsc, t.table.entries, t.table.amount].map((c, i) => (
                          <th key={c} scope="col" className={`px-4 py-3 font-semibold ${i >= 4 ? "text-right" : ""}`}>{c}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {preview.preview.groups.map((g) => (
                        <tr key={g.farmerId}>
                          <td className="px-4 py-3 font-semibold">{g.farmerCode}</td>
                          <td className="px-4 py-3">{g.farmerName}</td>
                          <td className="px-4 py-3 font-mono text-sm">{g.accountMasked}</td>
                          <td className="px-4 py-3 font-mono text-sm">{g.ifsc}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{g.entryCount}</td>
                          <td className="px-4 py-3 text-right font-bold tabular-nums">{formatInr(g.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {preview.preview.blocked.length > 0 && (
                <Notice tone="warn">
                  <p className="font-semibold">{n.blockedTitle}: {preview.preview.blockedTotals.farmers} · {formatInr(preview.preview.blockedTotals.amount)}</p>
                  <p className="mt-0.5">{n.blockedNote}</p>
                  <ul className="mt-2 space-y-1" data-testid="blocked-list">
                    {preview.preview.blocked.map((b) => (
                      <li key={b.farmerId}>
                        {b.farmerCode} {b.farmerName} · {b.entryCount} · {formatInr(b.amount)} <Badge tone="warn">{b.reason === "no_bank" ? n.noBank : n.bankUnverified}</Badge>
                      </li>
                    ))}
                  </ul>
                </Notice>
              )}

              {preview.preview.groups.length > 0 && (
                <Card>
                  <CardHeader><CardTitle>{n.generate}</CardTitle></CardHeader>
                  <CardContent><GenerateRunButton from={from} to={to} centreIds={chosen} t={n} /></CardContent>
                </Card>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
