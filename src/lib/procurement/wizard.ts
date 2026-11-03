import Decimal from "decimal.js";
import { MOISTURE_RULES } from "@/lib/calculations/procurement";
import type { Crop } from "@/types/domain";

export const WIZARD_STEPS = ["farmer", "crop", "gross", "tare", "moisture", "grade", "review"] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

/**
 * Keeps what the operator types a valid decimal as they type: digits and a
 * single point, a comma from a phone keypad is read as a point, and extra
 * decimal places are dropped, so a weight can never carry more than one.
 */
export function sanitizeDecimal(raw: string, maxDecimals: number): string {
  let text = raw.replace(",", ".").replace(/[^0-9.]/g, "");
  const firstDot = text.indexOf(".");
  if (firstDot !== -1) {
    const whole = text.slice(0, firstDot);
    const fraction = text.slice(firstDot + 1).replace(/\./g, "").slice(0, maxDecimals);
    text = `${whole === "" ? "0" : whole}.${fraction}`;
  }
  return text.replace(/^0+(?=\d)/, "");
}

/** "860" and "860." both become "860.0", ready to display and to store. */
export function toFixedText(value: string, decimals: number): string {
  return new Decimal(value === "" || value === "." ? "0" : value.replace(/\.$/, "")).toFixed(decimals);
}

export type StepError =
  | "required"
  | "number"
  | "grossPositive"
  | "tareTooHigh"
  | "moistureTooHigh";

const isNumber = (v: string) => /^\d+(\.\d{0,1})?$/.test(v);

export function validateGross(gross: string): StepError | null {
  if (gross.trim() === "") return "required";
  if (!isNumber(gross)) return "number";
  return new Decimal(gross.replace(/\.$/, "")).lte(0) ? "grossPositive" : null;
}

export function validateTare(tare: string, gross: string): StepError | null {
  if (tare.trim() === "") return "required";
  if (!isNumber(tare)) return "number";
  if (validateGross(gross)) return null;
  return new Decimal(tare.replace(/\.$/, "")).gte(new Decimal(gross.replace(/\.$/, ""))) ? "tareTooHigh" : null;
}

export function validateMoisture(moisture: string, crop: Crop): StepError | null {
  if (moisture.trim() === "") return "required";
  if (!isNumber(moisture)) return "number";
  return new Decimal(moisture.replace(/\.$/, "")).gt(MOISTURE_RULES[crop].maxPct) ? "moistureTooHigh" : null;
}
