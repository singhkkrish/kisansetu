import { describe, expect, it } from "vitest";
import {
  CalculationError,
  calculateProcurement,
  decimalEquals,
  sumMoney,
} from "@/lib/calculations/procurement";
import { formatInr, formatKg, istDate } from "@/lib/calculations/format";

describe("calculateProcurement: sample slips from the brief", () => {
  it("C07-24518: soybean at 11.5% moisture has no deduction", () => {
    const r = calculateProcurement({
      crop: "soybean", grossKg: "1250.0", tareKg: "18.0", moisturePct: "11.5", ratePerQuintal: "4850",
    });
    expect(r).toEqual({
      weighedKg: "1232.0", moistureDeductionPct: "0.00", netKg: "1232.0", amount: "59752.00",
    });
  });

  it("C07-24519: soybean at 14% moisture loses 2% of net weight", () => {
    const r = calculateProcurement({
      crop: "soybean", grossKg: "860.0", tareKg: "12.0", moisturePct: "14.0", ratePerQuintal: "4850",
    });
    // 848.0 kg x 0.98 = 831.04 -> 831.0 kg
    expect(r.moistureDeductionPct).toBe("2.00");
    expect(r.netKg).toBe("831.0");
    expect(r.amount).toBe("40303.50");
  });

  it("C12-08876: tur at 10% moisture", () => {
    const r = calculateProcurement({
      crop: "tur", grossKg: "640.0", tareKg: "10.0", moisturePct: "10.0", ratePerQuintal: "7200",
    });
    expect(r.netKg).toBe("630.0");
    expect(r.amount).toBe("45360.00");
  });
});

describe("calculateProcurement: rule details", () => {
  it("counts fractions of a moisture point pro rata", () => {
    const r = calculateProcurement({
      crop: "soybean", grossKg: "1000.0", tareKg: "0.0", moisturePct: "12.5", ratePerQuintal: "5000",
    });
    expect(r.moistureDeductionPct).toBe("0.50");
    expect(r.netKg).toBe("995.0");
  });

  it("rounds net weight half up to one decimal", () => {
    // 100.5 kg x 0.99 = 99.495 -> 99.5
    const r = calculateProcurement({
      crop: "tur", grossKg: "100.5", tareKg: "0.0", moisturePct: "13.0", ratePerQuintal: "100",
    });
    expect(r.netKg).toBe("99.5");
  });

  it("rounds the amount half up to the paisa", () => {
    // 33.3 kg x 4851.25 / 100 = 1615.5...; check exactness, not float drift
    const r = calculateProcurement({
      crop: "soybean", grossKg: "33.3", tareKg: "0.0", moisturePct: "10.0", ratePerQuintal: "4851.25",
    });
    expect(r.amount).toBe("1615.47");
  });

  it("is exact where binary floating point is not", () => {
    // 0.1 + 0.2 style drift must not appear in money
    const r = calculateProcurement({
      crop: "soybean", grossKg: "0.3", tareKg: "0.1", moisturePct: "10.0", ratePerQuintal: "10.10",
    });
    expect(r.netKg).toBe("0.2");
    expect(r.amount).toBe("0.02");
  });

  it("accepts numbers as well as strings", () => {
    const r = calculateProcurement({
      crop: "soybean", grossKg: 1250, tareKg: 18, moisturePct: 11.5, ratePerQuintal: 4850,
    });
    expect(r.amount).toBe("59752.00");
  });
});

describe("calculateProcurement: rejects bad input", () => {
  const base = { crop: "soybean", grossKg: "100.0", tareKg: "5.0", moisturePct: "11.0", ratePerQuintal: "4850" } as const;

  it.each([
    ["tare equal to gross", { tareKg: "100.0" }],
    ["tare above gross", { tareKg: "120.0" }],
    ["zero gross", { grossKg: "0", tareKg: "0" }],
    ["moisture above the limit", { moisturePct: "31.0" }],
    ["zero rate", { ratePerQuintal: "0" }],
    ["negative weight", { grossKg: "-5" }],
    ["two decimals on weight", { grossKg: "100.25" }],
    ["two decimals on moisture", { moisturePct: "11.25" }],
    ["three decimals on rate", { ratePerQuintal: "4850.123" }],
    ["text instead of a number", { grossKg: "abc" }],
  ])("%s", (_name, override) => {
    expect(() => calculateProcurement({ ...base, ...override })).toThrow(CalculationError);
  });
});

describe("money helpers", () => {
  it("sums exactly", () => {
    expect(sumMoney(["59752.00", "40303.50", "45360.00"])).toBe("145415.50");
    expect(sumMoney(["0.10", "0.20"])).toBe("0.30");
  });

  it("compares decimals by value", () => {
    expect(decimalEquals("4850", "4850.00")).toBe(true);
    expect(decimalEquals(4850, "4850.0")).toBe(true);
    expect(decimalEquals("4850.01", "4850")).toBe(false);
  });

  it("formats rupees with Indian grouping", () => {
    expect(formatInr("59752.00")).toBe("₹59,752.00");
    expect(formatInr("1234567.5")).toBe("₹12,34,567.50");
  });

  it("formats weights to one decimal", () => {
    expect(formatKg("1232")).toBe("1,232.0");
  });

  it("derives the India date from a UTC timestamp", () => {
    // 20:00 UTC on 1 Nov is already 2 Nov in India
    expect(istDate("2026-11-01T20:00:00.000Z")).toBe("2026-11-02");
    expect(istDate("2026-11-02T05:00:00.000Z")).toBe("2026-11-02");
  });
});
