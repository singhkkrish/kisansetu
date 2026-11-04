import { formatDisplayDate, formatInr, formatKg } from "@/lib/calculations/format";
import { CROP_NAMES, DISPUTE_WINDOW_DAYS, type SlipInput } from "@/lib/slip/slip";
import { buildSlipSms } from "@/lib/services/slip-message";

export type SmsLanguage = "mr" | "en";

/**
 * The text farmers receive. Marathi uses the same wording as the Part 1 slip
 * SMS, so there is one Marathi message in the product, not two.
 */
export function buildSmsBody(slip: SlipInput, language: SmsLanguage): string {
  if (language === "mr") {
    return buildSlipSms({
      slipNo: slip.slipNo,
      farmerName: slip.farmerName,
      crop: slip.crop,
      grade: slip.grade,
      grossKg: slip.grossKg,
      tareKg: slip.tareKg,
      moisturePct: slip.moisturePct,
      netKg: slip.netKg,
      ratePerQuintal: slip.ratePerQuintal,
      amount: slip.amount,
      recordedAt: slip.recordedAt,
    });
  }
  return [
    `Amount ${formatInr(slip.amount)}`,
    `${CROP_NAMES[slip.crop].en} (grade ${slip.grade}) - ${slip.farmerName}`,
    `Net weight ${formatKg(slip.netKg)} kg`,
    `Gross ${formatKg(slip.grossKg)} - tare ${formatKg(slip.tareKg)} kg`,
    `Moisture ${slip.moisturePct}%`,
    `Rate ${formatInr(slip.ratePerQuintal)} per quintal`,
    `Slip ${slip.slipNo} | ${formatDisplayDate(slip.recordedAt)}`,
    `Not paid yet. Report any mistake at the centre within ${DISPUTE_WINDOW_DAYS} days.`,
  ].join("\n");
}

export interface SmsLength {
  encoding: "GSM-7" | "UCS-2";
  characters: number;
  segments: number;
}

// Basic GSM 03.38 characters. Anything else, such as Devanagari or the rupee sign, forces UCS-2.
const GSM_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";

/** How many SMS parts a message costs: 70 characters in one part, 67 per part once it is split. */
export function smsLength(text: string): SmsLength {
  const chars = Array.from(text);
  const gsm = chars.every((c) => GSM_BASIC.includes(c));
  const single = gsm ? 160 : 70;
  const multi = gsm ? 153 : 67;
  const length = chars.length;
  return {
    encoding: gsm ? "GSM-7" : "UCS-2",
    characters: length,
    segments: length === 0 ? 0 : length <= single ? 1 : Math.ceil(length / multi),
  };
}
