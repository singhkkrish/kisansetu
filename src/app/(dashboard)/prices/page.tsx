import type { Metadata } from "next";
import { PriceBoard } from "@/components/prices/price-board";
import { Notice } from "@/components/ui/notice";
import { requirePermission } from "@/lib/auth/page-guard";
import { istDate } from "@/lib/calculations/format";
import { getMessages } from "@/lib/i18n/messages";
import { getPart4Messages } from "@/lib/i18n/part4-messages";
import { buildBoard } from "@/lib/prices/price-board";
import { listPriceVersions } from "@/lib/services/prices";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Daily price board" };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export default async function PricesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Office managers only. Checked before any price is read.
  const session = await requirePermission("prices:write");
  const lang = session.profile.preferred_lang;
  const t = getMessages(lang);
  const t4 = getPart4Messages(lang);

  const todayIst = istDate(new Date().toISOString());
  const raw = (await searchParams).date;
  const date = typeof raw === "string" && DATE.test(raw) ? raw : todayIst;

  const { items, error } = await listPriceVersions(await createClient(), { from: date, to: date });
  if (error) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">{t4.prices.title}</h1>
        <Notice tone="error">{t4.history.error}</Notice>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold">{t4.prices.title}</h1>
      {/* Keyed by date and by what is stored, so the form starts fresh after every save or publish. */}
      <PriceBoard
        key={`${date}-${items.map((i) => `${i.id}:${i.status}:${i.rate}`).join(",")}`}
        date={date}
        todayIst={todayIst}
        slots={buildBoard(items, date)}
        t={t}
        t4={t4}
      />
    </div>
  );
}
