import Link from "next/link";
import { AnomalyActions } from "@/components/anomalies/anomaly-actions";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { describeAnomaly } from "@/lib/anomalies/describe";
import { formatDisplayDate, formatInr, formatKg } from "@/lib/calculations/format";
import type { Part6Messages } from "@/lib/i18n/part6-messages";
import type { AnomalyItem } from "@/lib/services/anomalies";

const TONE = { open: "warn", reviewed: "neutral", confirmed: "danger", false_positive: "success" } as const;

/** One flagged entry: who, where, why, the numbers involved, and the review actions. */
export function AnomalyCard({ item, t, lang, showEntryLink = true }: { item: AnomalyItem; t: Part6Messages["anomalies"]; lang: "mr" | "en"; showEntryLink?: boolean }) {
  const held = item.status === "open" && item.paymentStatus === "unpaid";
  return (
    <Card data-testid={`anomaly-${item.id}`}>
      <CardContent className="space-y-4 pt-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-lg font-bold">
              {showEntryLink ? <Link href={`/procurement/${item.entryId}`} className="text-primary underline">{item.slipNo}</Link> : item.slipNo}
              <span className="ml-2 font-normal text-muted">· {item.farmerName} ({item.farmerCode}) · {item.centreCode} {item.centreName}</span>
            </p>
            <p className="mt-1 text-base font-semibold">{t.rules[item.rule] ?? item.rule}</p>
          </div>
          <Badge tone={TONE[item.status]}>{t.statuses[item.status]}</Badge>
        </div>

        <div>
          <p className="text-sm font-semibold text-muted">{t.why}</p>
          <p className="text-base" data-testid="anomaly-reason">{describeAnomaly(item.rule, item.details, lang)}</p>
        </div>

        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div><dt className="text-muted">{t.values}</dt><dd className="font-semibold tabular-nums">{formatKg(item.grossKg)} kg · {formatKg(item.netKg)} kg · {item.moisturePct}%</dd></div>
          <div><dt className="text-muted">{t.entry}</dt><dd className="font-semibold tabular-nums">{formatInr(item.amount)}</dd></div>
          <div><dt className="text-muted">{t.raised}</dt><dd className="font-semibold">{formatDisplayDate(item.raisedAt)}</dd></div>
          <div><dt className="text-muted">{t.payment}</dt><dd className="font-semibold">{held ? t.paymentHeld : t.paymentFree}</dd></div>
        </dl>

        {item.reviewedAt && (
          <p className="text-sm text-muted">
            {t.reviewedBy}: {item.reviewedByName ?? "—"} · {formatDisplayDate(item.reviewedAt)}
            {item.reviewNote ? <span className="block text-ink">{t.note}: “{item.reviewNote}”</span> : null}
          </p>
        )}

        <AnomalyActions flagId={item.id} t={t} />
        <p className="text-xs text-muted">{t.noReleaseNote}</p>
      </CardContent>
    </Card>
  );
}
