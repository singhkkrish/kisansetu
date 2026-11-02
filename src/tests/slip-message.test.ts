import { describe, expect, it } from "vitest";
import { buildSlipSms } from "@/lib/services/slip-message";

describe("buildSlipSms", () => {
  const sms = buildSlipSms({
    slipNo: "C07-24519",
    farmerName: "Kamal Shinde",
    crop: "soybean",
    grade: "A",
    grossKg: "860.0",
    tareKg: "12.0",
    moisturePct: "14.0",
    netKg: "831.0",
    ratePerQuintal: "4850",
    amount: "40303.50",
    recordedAt: "2026-11-02T06:00:00.000Z",
  });

  it("leads with the amount in rupees", () => {
    expect(sms.split("\n")[0]).toBe("रक्कम ₹40,303.50");
  });

  it("prints every value the farmer could dispute", () => {
    expect(sms).toContain("सोयाबीन");
    expect(sms).toContain("Kamal Shinde");
    expect(sms).toContain("831.0");
    expect(sms).toContain("860.0");
    expect(sms).toContain("12.0");
    expect(sms).toContain("14.0%");
    expect(sms).toContain("₹4,850.00");
    expect(sms).toContain("C07-24519");
    expect(sms).toContain("02/11/2026");
  });

  it("uses the Marathi name for tur", () => {
    expect(buildSlipSms({ ...baseSlip(), crop: "tur" })).toContain("तूर");
  });
});

function baseSlip() {
  return {
    slipNo: "C12-08876",
    farmerName: "Mohan Biradar",
    crop: "tur" as const,
    grade: "A" as const,
    grossKg: "640.0",
    tareKg: "10.0",
    moisturePct: "10.0",
    netKg: "630.0",
    ratePerQuintal: "7200",
    amount: "45360.00",
    recordedAt: "2026-11-02T06:00:00.000Z",
  };
}
