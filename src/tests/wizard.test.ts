import { describe, expect, it } from "vitest";
import {
  sanitizeDecimal,
  toFixedText,
  validateGross,
  validateMoisture,
  validateTare,
} from "@/lib/procurement/wizard";

describe("sanitizeDecimal", () => {
  it.each([
    ["860", "860"],
    ["860.55", "860.5"],
    ["860,5", "860.5"],
    ["8a6b0", "860"],
    ["-5", "5"],
    [".5", "0.5"],
    ["1.2.3", "1.2"],
    ["007", "7"],
    ["", ""],
  ])("turns %j into %j", (typed, expected) => {
    expect(sanitizeDecimal(typed, 1)).toBe(expected);
  });

  it("allows two places for money", () => {
    expect(sanitizeDecimal("4850.255", 2)).toBe("4850.25");
  });
});

describe("toFixedText", () => {
  it("pads to the requested places without floating point drift", () => {
    expect(toFixedText("860", 1)).toBe("860.0");
    expect(toFixedText("11.", 1)).toBe("11.0");
    expect(toFixedText("0.3", 1)).toBe("0.3");
  });
});

describe("step validation", () => {
  it("checks gross weight", () => {
    expect(validateGross("")).toBe("required");
    expect(validateGross("0")).toBe("grossPositive");
    expect(validateGross("0.0")).toBe("grossPositive");
    expect(validateGross("1250.0")).toBeNull();
    expect(validateGross("12.55")).toBe("number");
  });

  it("requires tare to be below gross, and allows zero tare", () => {
    expect(validateTare("", "100")).toBe("required");
    expect(validateTare("100", "100")).toBe("tareTooHigh");
    expect(validateTare("100.1", "100")).toBe("tareTooHigh");
    expect(validateTare("0", "100")).toBeNull();
    expect(validateTare("18.0", "1250.0")).toBeNull();
  });

  it("stops moisture above the purchasable limit", () => {
    expect(validateMoisture("", "soybean")).toBe("required");
    expect(validateMoisture("30", "tur")).toBeNull();
    expect(validateMoisture("30.1", "tur")).toBe("moistureTooHigh");
    expect(validateMoisture("11.5", "soybean")).toBeNull();
  });
});
