import { formatInr, formatKg } from "@/lib/calculations/format";
import type { Crop, Grade } from "@/types/domain";

export const CROP_NAMES_MR: Record<Crop, string> = {
  soybean: "सोयाबीन",
  tur: "तूर",
};

export interface SlipDetails {
  slipNo: string;
  farmerName: string;
  crop: Crop;
  grade: Grade;
  grossKg: string;
  tareKg: string;
  moisturePct: string;
  netKg: string;
  ratePerQuintal: string;
  amount: string;
  /** ISO timestamp the produce was weighed. */
  recordedAt: string;
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(iso));
}

/**
 * Marathi SMS slip. Every value that affects the money is printed so the
 * farmer can spot a wrong figure and dispute it. The amount comes first
 * because it is what the farmer looks for.
 */
export function buildSlipSms(slip: SlipDetails): string {
  return [
    `रक्कम ${formatInr(slip.amount)}`,
    `${CROP_NAMES_MR[slip.crop]} (ग्रेड ${slip.grade}) - ${slip.farmerName}`,
    `निव्वळ वजन ${formatKg(slip.netKg)} किग्रॅ`,
    `एकूण ${formatKg(slip.grossKg)} - बारदान ${formatKg(slip.tareKg)} किग्रॅ`,
    `ओलावा ${slip.moisturePct}%`,
    `दर ${formatInr(slip.ratePerQuintal)} प्रति क्विंटल`,
    `पावती ${slip.slipNo} | ${formatDate(slip.recordedAt)}`,
    `४८ तासांत खात्यात जमा होईल. चूक असल्यास केंद्रावर कळवा.`,
  ].join("\n");
}
