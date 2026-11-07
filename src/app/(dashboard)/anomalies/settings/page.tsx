import type { Metadata } from "next";
import { BackLink } from "@/components/members/back-link";
import { SettingRow } from "@/components/anomalies/setting-row";
import { Notice } from "@/components/ui/notice";
import { requirePermission } from "@/lib/auth/page-guard";
import { getPart6Messages } from "@/lib/i18n/part6-messages";
import { listAnomalySettings } from "@/lib/services/anomalies";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Anomaly thresholds" };

export default async function AnomalySettingsPage() {
  const session = await requirePermission("anomalies:review");
  const lang = session.profile.preferred_lang;
  const t = getPart6Messages(lang);
  const { items, error } = await listAnomalySettings(await createClient());

  return (
    <div className="space-y-6">
      <BackLink href="/anomalies" label={t.anomalies.title} />
      <div>
        <h1 className="text-2xl font-bold">{t.settings.title}</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">{t.settings.intro}</p>
      </div>
      <Notice tone="warn">{t.anomalies.assumptionBanner}</Notice>
      {error ? (
        <Notice tone="error">{t.anomalies.loadError}</Notice>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full min-w-[40rem] text-left text-base">
            <tbody className="divide-y divide-line">
              {items.map((s) => <SettingRow key={s.key} setting={s} t={t.settings} />)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
