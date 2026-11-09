import type { Metadata } from "next";
import Link from "next/link";
import { AnomalyCard } from "@/components/anomalies/anomaly-card";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { Select } from "@/components/ui/select";
import { requirePermission } from "@/lib/auth/page-guard";
import { getPart6Messages } from "@/lib/i18n/part6-messages";
import { ANOMALY_LIST_LIMIT, ANOMALY_STATUSES, listAnomalies, parseAnomalyStatus } from "@/lib/services/anomalies";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Flagged entries" };

export default async function AnomaliesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requirePermission("anomalies:read");
  const lang = session.profile.preferred_lang;
  const t = getPart6Messages(lang).anomalies;
  const params = await searchParams;
  const status = parseAnomalyStatus(params.status ?? "open");
  const centreParam = typeof params.centre === "string" && /^[0-9a-f-]{36}$/i.test(params.centre) ? params.centre : "";

  const supabase = await createClient();
  const [{ items, error }, { data: centres }] = await Promise.all([
    listAnomalies(supabase, params.status === "all" ? "all" : status, centreParam || null),
    supabase.from("centres").select("id, code, name").order("code"),
  ]);
  const href = (s: string) => `/anomalies?status=${s}${centreParam ? `&centre=${centreParam}` : ""}`;
  const active = params.status === "all" ? "all" : status === "all" ? "open" : status;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t.title}</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted">{t.intro}</p>
        </div>
        <Button asChild variant="secondary"><Link href="/anomalies/settings">{t.thresholds}</Link></Button>
      </div>
      <Notice tone="warn">{t.assumptionBanner}</Notice>

      <form method="get" action="/anomalies" className="flex flex-wrap items-end gap-3 rounded-xl border border-line bg-surface p-4">
        <input type="hidden" name="status" value={active} />
        <div className="min-w-48">
          <label htmlFor="centre" className="mb-1.5 block text-sm font-semibold">{t.centre}</label>
          <Select id="centre" name="centre" defaultValue={centreParam}>
            <option value="">—</option>
            {(centres ?? []).map((c) => <option key={c.id as string} value={c.id as string}>{c.code as string} · {c.name as string}</option>)}
          </Select>
        </div>
        <Button type="submit" variant="secondary">{t.apply}</Button>
      </form>

      <nav aria-label={t.status} className="flex flex-wrap gap-2">
        {[...ANOMALY_STATUSES, "all" as const].map((s) => (
          <Link
            key={s}
            href={href(s)}
            aria-current={active === s ? "page" : undefined}
            className={`inline-flex h-11 items-center rounded-lg border px-4 text-base font-semibold ${active === s ? "border-primary bg-primary-soft text-primary" : "border-line bg-surface"}`}
          >
            {s === "all" ? t.all : t.statuses[s]}
          </Link>
        ))}
      </nav>

      {error ? (
        <Notice tone="error">{t.loadError}</Notice>
      ) : items.length === 0 ? (
        <p className="text-muted">{t.empty}</p>
      ) : (
        <div className="space-y-4" data-testid="anomaly-list">
          {items.map((item) => <AnomalyCard key={item.id} item={item} t={t} lang={lang} />)}
          {items.length === ANOMALY_LIST_LIMIT && <p className="text-sm text-muted">{t.showing} {ANOMALY_LIST_LIMIT}</p>}
        </div>
      )}
    </div>
  );
}
