import { getPart6Messages } from "@/lib/i18n/part6-messages";

type Details = Record<string, unknown>;

const num = (v: unknown, digits = 1): string => {
  const n = Number(v);
  return Number.isFinite(n) ? String(Number(n.toFixed(digits))) : "?";
};

/**
 * The reason a flag was raised, in words, built from the values stored with it.
 * Nothing here decides anything; it only explains the stored numbers.
 */
export function describeAnomaly(rule: string, details: Details, lang: "mr" | "en"): string {
  const template = getPart6Messages(lang).anomalies.detail[rule];
  if (!template) return rule;
  const d = details ?? {};
  const slips = Array.isArray(d.other_slips) ? (d.other_slips as unknown[]).map(String).join(", ") : "";
  const others = Number(d.other_entries ?? 0);
  const values: Record<string, string> = {
    total: num(d.total_kg),
    this: num(d.this_kg ?? d.this_pct),
    days: num(d.window_days, 0),
    limit: num(d.limit_kg ?? d.max_range_pct),
    acres: num(d.land_acres, 2),
    perAcre: num(d.max_kg_per_acre, 0),
    others: String(others),
    plural: others === 1 ? "y" : "ies",
    window: num(d.window_minutes, 0),
    nearest: num(d.nearest_minutes),
    slips,
    readings: num(d.readings, 0),
    min: num(d.min_pct),
    max: num(d.max_pct),
    range: num(d.range_pct, 2),
    median: num(d.median_kg),
    mean: num(d.mean_pct),
    n: num(d.history_entries, 0),
    ratio: num(d.ratio),
    shift: num(d.shift_pct),
  };
  return template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? "?");
}
