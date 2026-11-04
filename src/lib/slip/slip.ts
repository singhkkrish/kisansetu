import Decimal from "decimal.js";
import { formatDisplayDate, formatInr, formatKg } from "@/lib/calculations/format";
import { calculateProcurement } from "@/lib/calculations/procurement";
import type { Crop, Grade, PaymentStatus } from "@/types/domain";

/** Days a farmer has to question a slip. One number, used by the slip and the SMS. */
export const DISPUTE_WINDOW_DAYS = 7;

export interface Bilingual {
  mr: string;
  en: string;
}

export const CROP_NAMES: Record<Crop, Bilingual> = {
  soybean: { mr: "सोयाबीन", en: "Soybean" },
  tur: { mr: "तूर", en: "Tur" },
};

/** What the slip says about payment. Kept plain: the farmer's first question is "when do I get paid?". */
export const PAYMENT_LABELS: Record<PaymentStatus, Bilingual> = {
  unpaid: { mr: "पैसे अजून दिलेले नाहीत", en: "Not paid yet" },
  in_run: { mr: "पैसे देण्याची प्रक्रिया सुरू आहे", en: "Payment in progress" },
  paid: { mr: "पैसे दिले आहेत", en: "Paid" },
  failed: { mr: "पेमेंट अयशस्वी, केंद्राशी संपर्क करा", en: "Payment failed, contact the centre" },
};

export const SLIP_LABELS = {
  title: { mr: "खरेदी पावती", en: "Purchase slip" },
  slipNo: { mr: "पावती क्र.", en: "Slip no." },
  farmer: { mr: "शेतकरी", en: "Farmer" },
  farmerId: { mr: "सभासद क्र.", en: "Member ID" },
  village: { mr: "गाव", en: "Village" },
  centre: { mr: "खरेदी केंद्र", en: "Centre" },
  crop: { mr: "पीक", en: "Crop" },
  grade: { mr: "ग्रेड", en: "Grade" },
  gross: { mr: "एकूण वजन", en: "Gross weight" },
  tare: { mr: "बारदान (टेअर)", en: "Tare" },
  moisture: { mr: "ओलावा", en: "Moisture" },
  deduction: { mr: "ओलावा कपात", en: "Moisture deduction" },
  rate: { mr: "दर", en: "Rate" },
  net: { mr: "निव्वळ वजन", en: "Net weight" },
  amount: { mr: "देय रक्कम", en: "Amount payable" },
  when: { mr: "दिनांक व वेळ", en: "Date and time" },
  payment: { mr: "पेमेंट स्थिती", en: "Payment status" },
  dispute: { mr: "चूक वाटल्यास", en: "If something looks wrong" },
} as const satisfies Record<string, Bilingual>;

export const DISPUTE_TEXT: Bilingual = {
  mr: `वजन, ओलावा किंवा रकमेत चूक वाटल्यास ${DISPUTE_WINDOW_DAYS} दिवसांच्या आत ही पावती घेऊन केंद्रावर या आणि पावती क्रमांक सांगा. केंद्र व्यवस्थापक तपासणी करतील.`,
  en: `If you find a mistake in the weight, moisture or amount, bring this slip to the centre within ${DISPUTE_WINDOW_DAYS} days and quote the slip number. The centre manager will check it.`,
};

export interface SlipInput {
  slipNo: string;
  farmerName: string;
  farmerCode: string;
  village: string;
  centreName: string;
  centreCode: string;
  crop: Crop;
  grade: Grade;
  grossKg: string;
  tareKg: string;
  moisturePct: string;
  ratePerQuintal: string;
  netKg: string;
  amount: string;
  /** Effective date and version of the published rate the entry used. */
  rateDate?: string | null;
  rateVersion?: number | null;
  /** When the produce was weighed, by the phone's clock (unverified). */
  recordedAt: string;
  /** When the server stored it. Absent until the server has confirmed the entry. */
  serverReceivedAt?: string | null;
  paymentStatus: PaymentStatus;
}

export interface SlipRow {
  key: keyof typeof SLIP_LABELS;
  label: Bilingual;
  value: Bilingual;
}

export interface SlipModel {
  title: Bilingual;
  slipNo: string;
  /** The two numbers a farmer looks for first, shown large. */
  headline: { amount: string; netKg: string };
  /** Identity block: who, where. */
  identity: SlipRow[];
  /** The working, in the order the money is worked out. */
  details: SlipRow[];
  payment: { status: PaymentStatus; label: Bilingual };
  dispute: Bilingual;
  /** Footer lines: the time the server confirmed the entry, or that it has not yet. */
  confirmation: Bilingual;
}

function dateTime(iso: string): string {
  const time = new Date(iso).toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
  // Some runtimes write "am"; the slip always writes "AM".
  return `${formatDisplayDate(iso)}, ${time.toUpperCase()}`;
}

const same = (text: string): Bilingual => ({ mr: text, en: text });

/** Kilograms taken off for moisture, as an exact one-decimal string. */
export function deductionKg(grossKg: string, tareKg: string, netKg: string): string {
  return new Decimal(grossKg).minus(tareKg).minus(netKg).toFixed(1);
}

/**
 * Turns an entry into what the slip shows, in Marathi and English. The figures
 * are the entry's own stored values; only the deduction percentage is derived,
 * with the same calculation service the entry itself used.
 */
export function buildSlip(input: SlipInput): SlipModel {
  const calc = calculateProcurement({
    crop: input.crop,
    grossKg: input.grossKg,
    tareKg: input.tareKg,
    moisturePct: input.moisturePct,
    ratePerQuintal: input.ratePerQuintal,
  });
  const lostKg = deductionKg(input.grossKg, input.tareKg, input.netKg);
  const noDeduction = new Decimal(calc.moistureDeductionPct).isZero();

  const rateEn = `${formatInr(input.ratePerQuintal)} / quintal`;
  const rateMr = `${formatInr(input.ratePerQuintal)} / क्विंटल`;
  const rateNote = input.rateDate ? ` (${formatDisplayDate(`${input.rateDate}T06:30:00Z`)})` : "";

  const L = SLIP_LABELS;
  const row = (key: keyof typeof SLIP_LABELS, value: Bilingual): SlipRow => ({ key, label: L[key], value });

  return {
    title: L.title,
    slipNo: input.slipNo,
    headline: { amount: formatInr(input.amount), netKg: `${formatKg(input.netKg)} kg` },
    identity: [
      row("farmer", same(input.farmerName)),
      row("farmerId", same(input.farmerCode)),
      row("village", same(input.village)),
      row("centre", same(`${input.centreName} (${input.centreCode})`)),
    ],
    details: [
      row("crop", CROP_NAMES[input.crop]),
      row("grade", same(input.grade)),
      row("gross", same(`${formatKg(input.grossKg)} kg`)),
      row("tare", same(`${formatKg(input.tareKg)} kg`)),
      row("moisture", same(`${input.moisturePct}%`)),
      row("deduction", {
        mr: noDeduction ? "कपात नाही (0.0 kg)" : `${calc.moistureDeductionPct}% (${formatKg(lostKg)} kg)`,
        en: noDeduction ? "None (0.0 kg)" : `${calc.moistureDeductionPct}% (${formatKg(lostKg)} kg)`,
      }),
      row("rate", { mr: `${rateMr}${rateNote}`, en: `${rateEn}${rateNote}` }),
      row("net", same(`${formatKg(input.netKg)} kg`)),
      row("amount", same(formatInr(input.amount))),
      row("when", same(dateTime(input.recordedAt))),
    ],
    payment: { status: input.paymentStatus, label: PAYMENT_LABELS[input.paymentStatus] },
    dispute: DISPUTE_TEXT,
    confirmation: input.serverReceivedAt
      ? { mr: `सर्व्हरवर नोंद: ${dateTime(input.serverReceivedAt)}`, en: `Recorded on server: ${dateTime(input.serverReceivedAt)}` }
      : { mr: "सर्व्हरवर नोंद होणे बाकी", en: "Not yet recorded on the server" },
  };
}
