import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SyncPanel } from "@/components/procurement/sync-panel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { formatInr, istDate } from "@/lib/calculations/format";
import { getMessages } from "@/lib/i18n/messages";
import { getSession } from "@/lib/services/session";
import { createClient } from "@/lib/supabase/server";
import type { Crop } from "@/types/domain";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const t = getMessages(session.profile.preferred_lang);
  // requirePermission() sends people here with ?denied=1 when a page is not theirs to open.
  const denied = (await searchParams).denied !== undefined;
  const supabase = await createClient();
  const today = istDate(new Date().toISOString());

  const { data: prices, error: priceError } = await supabase
    .from("daily_prices")
    .select("crop, grade, rate_per_quintal")
    .eq("price_date", today)
    .order("crop")
    .order("grade");

  const isManager = session.profile.role === "office_manager";
  const stats = isManager ? await loadManagerStats() : null;

  return (
    <div className="space-y-8">
      {denied && (
        <Notice tone="warn">
          <p className="font-semibold">{t.forbidden.title}</p>
          <p className="mt-0.5">{t.forbidden.body}</p>
        </Notice>
      )}

      <h1 className="text-2xl font-bold">
        {t.dashboard.welcome}, {session.profile.full_name}
      </h1>

      {stats && (
        <dl className="grid gap-4 sm:grid-cols-3">
          <Stat label={t.dashboard.membersCount} value={stats.members} />
          <Stat label={t.dashboard.centresCount} value={stats.centres} />
          <Stat label={t.dashboard.heldCount} value={stats.held} />
        </dl>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>
              {t.dashboard.todaysPrices}
              <span className="ml-2 text-sm font-normal text-muted">{today}</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {priceError ? (
              <Notice tone="error">{t.dashboard.priceLoadError}</Notice>
            ) : !prices || prices.length === 0 ? (
              <p className="text-muted">{t.dashboard.noPricesToday}</p>
            ) : (
              <ul className="divide-y divide-line">
                {prices.map((p) => (
                  <li key={`${p.crop}-${p.grade}`} className="flex items-baseline justify-between py-3">
                    <span className="text-base font-semibold">
                      {t.crops[p.crop as Crop]}{" "}
                      <span className="font-normal text-muted">
                        {t.dashboard.grade} {p.grade}
                      </span>
                    </span>
                    <span className="text-right">
                      <span className="text-2xl font-bold tabular-nums">{formatInr(String(p.rate_per_quintal))}</span>
                      <span className="block text-xs text-muted">{t.dashboard.perQuintal}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {!isManager && <SyncPanel t={t.sync} />}
      </div>
    </div>
  );

  async function loadManagerStats() {
    const count = async (table: string, filter?: (q: ReturnType<typeof base>) => ReturnType<typeof base>) => {
      const q = filter ? filter(base(table)) : base(table);
      const { count: n } = await q;
      return n ?? 0;
    };
    function base(table: string) {
      return supabase.from(table).select("id", { count: "exact", head: true });
    }
    const [members, centres, held] = await Promise.all([
      count("farmer_members", (q) => q.eq("active", true)),
      count("centres", (q) => q.eq("active", true)),
      count("procurement_entries", (q) => q.eq("approval_status", "held")),
    ]);
    return { members, centres, held };
  }
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="pt-5">
        <dt className="text-sm text-muted">{label}</dt>
        <dd className="mt-1 text-4xl font-bold tabular-nums">{value}</dd>
      </CardContent>
    </Card>
  );
}
