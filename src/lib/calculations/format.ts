const inr = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const kg = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** "59752.00" -> "₹59,752.00" (Indian digit grouping). Accepts exact strings. */
export function formatInr(amount: string | number): string {
  return `₹${inr.format(amount as never)}`;
}

/** "1232.0" -> "1,232.0" */
export function formatKg(weight: string | number): string {
  return kg.format(weight as never);
}

/** Calendar date (YYYY-MM-DD) in India Standard Time for an ISO timestamp. */
export function istDate(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
