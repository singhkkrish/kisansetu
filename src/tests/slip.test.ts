import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DISPUTE_WINDOW_DAYS, PAYMENT_LABELS, SLIP_LABELS, buildSlip, deductionKg, type SlipInput } from "@/lib/slip/slip";
import { buildSmsBody } from "@/lib/sms/message";

const base: SlipInput = {
  slipNo: "C07-24519",
  farmerName: "Kamal Shinde",
  farmerCode: "FM00102",
  village: "Ganjur",
  centreName: "Ganjur Collection Centre",
  centreCode: "C07",
  crop: "soybean",
  grade: "A",
  grossKg: "860.0",
  tareKg: "12.0",
  moisturePct: "14.0",
  ratePerQuintal: "4850.00",
  netKg: "831.0",
  amount: "40303.50",
  rateDate: "2026-11-02",
  rateVersion: 1,
  recordedAt: "2026-11-02T00:55:00.000Z", // 06:25 in India
  serverReceivedAt: null,
  paymentStatus: "unpaid",
};

const find = (slip: ReturnType<typeof buildSlip>, key: string) =>
  [...slip.identity, ...slip.details].find((r) => r.key === key)!;

describe("Marathi and English slip", () => {
  const slip = buildSlip(base);

  it("carries every field the farmer is owed", () => {
    const keys = [...slip.identity, ...slip.details].map((r) => r.key);
    expect(keys).toEqual([
      "farmer", "farmerId", "village", "centre",
      "crop", "grade", "gross", "tare", "moisture", "deduction", "rate", "net", "amount", "when",
    ]);
    expect(slip.slipNo).toBe("C07-24519");
    expect(slip.payment.label).toEqual(PAYMENT_LABELS.unpaid);
    expect(slip.dispute.mr).toBeTruthy();
    expect(slip.dispute.en).toBeTruthy();
  });

  it("states the sample figures exactly", () => {
    expect(find(slip, "farmer").value.mr).toBe("Kamal Shinde");
    expect(find(slip, "farmerId").value.en).toBe("FM00102");
    expect(find(slip, "village").value.mr).toBe("Ganjur");
    expect(find(slip, "centre").value.en).toBe("Ganjur Collection Centre (C07)");
    expect(find(slip, "gross").value.en).toBe("860.0 kg");
    expect(find(slip, "tare").value.en).toBe("12.0 kg");
    expect(find(slip, "moisture").value.en).toBe("14.0%");
    expect(find(slip, "net").value.en).toBe("831.0 kg");
    expect(find(slip, "amount").value.en).toBe("₹40,303.50");
    expect(find(slip, "when").value.en).toBe("02 Nov 2026, 06:25 AM");
  });

  it("shows the moisture deduction as a percentage and as kilograms", () => {
    expect(find(slip, "deduction").value.mr).toBe("2.00% (17.0 kg)");
    expect(deductionKg("860.0", "12.0", "831.0")).toBe("17.0");
  });

  it("says plainly when there is no deduction", () => {
    const none = buildSlip({ ...base, moisturePct: "11.5", grossKg: "1250.0", tareKg: "18.0", netKg: "1232.0", amount: "59752.00" });
    expect(find(none, "deduction").value.mr).toBe("कपात नाही (0.0 kg)");
    expect(find(none, "deduction").value.en).toBe("None (0.0 kg)");
    expect(none.headline.amount).toBe("₹59,752.00");
  });

  it("puts the two numbers a farmer looks for first, as the headline", () => {
    expect(slip.headline).toEqual({ amount: "₹40,303.50", netKg: "831.0 kg" });
  });

  it("is written in Marathi: every label and the payment and dispute text use Devanagari", () => {
    const devanagari = /[ऀ-ॿ]/;
    for (const label of Object.values(SLIP_LABELS)) expect(label.mr).toMatch(devanagari);
    for (const label of Object.values(PAYMENT_LABELS)) expect(label.mr).toMatch(devanagari);
    expect(slip.dispute.mr).toMatch(devanagari);
    expect(slip.title.mr).toBe("खरेदी पावती");
    expect(find(slip, "crop").value.mr).toBe("सोयाबीन");
    expect(find(slip, "crop").value.en).toBe("Soybean");
  });

  it("gives the dispute window in days and tells the farmer what to do", () => {
    expect(DISPUTE_WINDOW_DAYS).toBe(7);
    expect(slip.dispute.en).toContain("within 7 days");
    expect(slip.dispute.en).toContain("slip number");
    expect(slip.dispute.mr).toContain("7 दिवसांच्या आत");
    expect(slip.dispute.mr).toContain("पावती क्रमांक");
  });

  it("shows the effective date of the rate used", () => {
    expect(find(slip, "rate").value.en).toBe("₹4,850.00 / quintal (02 Nov 2026)");
    expect(find(slip, "rate").value.mr).toBe("₹4,850.00 / क्विंटल (02 Nov 2026)");
  });

  it("does not claim the server has the entry until it does", () => {
    expect(slip.confirmation.en).toBe("Not yet recorded on the server");
    const synced = buildSlip({ ...base, serverReceivedAt: "2026-11-02T01:30:00.000Z" });
    expect(synced.confirmation.en).toBe("Recorded on server: 02 Nov 2026, 07:00 AM");
  });

  it("reports each payment state in both languages", () => {
    for (const status of ["unpaid", "in_run", "paid", "failed"] as const) {
      const s = buildSlip({ ...base, paymentStatus: status });
      expect(s.payment.label.mr).toBeTruthy();
      expect(s.payment.label.en).toBeTruthy();
    }
    expect(PAYMENT_LABELS.paid.en).toBe("Paid");
  });

  it("renders the tur sample too", () => {
    const tur = buildSlip({
      ...base, slipNo: "C12-08876", farmerName: "Mohan Biradar", farmerCode: "FM00203", village: "Murud",
      centreName: "Murud Collection Centre", centreCode: "C12", crop: "tur", grossKg: "640.0", tareKg: "10.0",
      moisturePct: "10.0", netKg: "630.0", ratePerQuintal: "7200.00", amount: "45360.00",
    });
    expect(find(tur, "crop").value.mr).toBe("तूर");
    expect(tur.headline.amount).toBe("₹45,360.00");
  });
});

describe("Devanagari font support", () => {
  const css = fs.readFileSync(path.resolve(import.meta.dirname, "../app/globals.css"), "utf8");

  it("lists a Devanagari font ahead of the generic fallbacks", () => {
    const stack = css.match(/--font-sans:([^;]+);/)![1];
    expect(stack).toMatch(/Noto Sans Devanagari/);
    expect(stack.indexOf("Noto Sans Devanagari")).toBeLessThan(stack.indexOf("system-ui"));
  });
});

describe("slip SMS text", () => {
  it("opens with the amount and states the sample figures in Marathi", () => {
    const sms = buildSmsBody(base, "mr");
    expect(sms.split("\n")[0]).toBe("रक्कम ₹40,303.50");
    expect(sms).toContain("निव्वळ वजन 831.0 किग्रॅ");
    expect(sms).toContain("दर ₹4,850.00 प्रति क्विंटल");
    expect(sms).toContain("C07-24519");
    expect(sms).toMatch(/[ऀ-ॿ]/);
  });

  it("has an English version with the same figures", () => {
    const sms = buildSmsBody(base, "en");
    expect(sms).toContain("Amount ₹40,303.50");
    expect(sms).toContain("Net weight 831.0 kg");
    expect(sms).toContain("within 7 days");
  });
});
