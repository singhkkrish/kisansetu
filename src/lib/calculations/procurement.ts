import Decimal from "decimal.js";
import type { Crop } from "@/types/domain";

// Money and weight maths never touch binary floating point. Every value is a
// Decimal and results are returned as fixed-point strings.
const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export type DecimalInput = string | number;

/**
 * Deduction rule table. Net weight is reduced by `deductionPctPerPoint` percent
 * for every moisture point above `basePct` (fractions of a point count pro rata).
 * The same rule is enforced by a CHECK constraint in the database.
 */
export const MOISTURE_RULES: Record<
  Crop,
  { basePct: string; deductionPctPerPoint: string; maxPct: string }
> = {
  soybean: { basePct: "12", deductionPctPerPoint: "1", maxPct: "30" },
  tur: { basePct: "12", deductionPctPerPoint: "1", maxPct: "30" },
};

export class CalculationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalculationError";
  }
}

export interface ProcurementCalcInput {
  crop: Crop;
  grossKg: DecimalInput;
  tareKg: DecimalInput;
  moisturePct: DecimalInput;
  ratePerQuintal: DecimalInput;
}

export interface ProcurementCalcResult {
  /** Gross minus tare, before any moisture deduction. kg, 1 decimal. */
  weighedKg: string;
  /** Percentage taken off for excess moisture, 2 decimals. */
  moistureDeductionPct: string;
  /** Payable weight. kg, 1 decimal. */
  netKg: string;
  /** Payable money, 2 decimals. */
  amount: string;
}

function parse(value: DecimalInput, label: string, maxDecimals: number): Decimal {
  const text = typeof value === "number" ? String(value) : value.trim();
  if (!/^\d+(\.\d+)?$/.test(text)) {
    throw new CalculationError(`${label} must be a positive number`);
  }
  const fraction = text.split(".")[1];
  if (fraction && fraction.length > maxDecimals) {
    throw new CalculationError(`${label} allows at most ${maxDecimals} decimal place(s)`);
  }
  return new D(text);
}

export function calculateProcurement(input: ProcurementCalcInput): ProcurementCalcResult {
  const rule = MOISTURE_RULES[input.crop];
  if (!rule) throw new CalculationError(`Unknown crop: ${input.crop}`);

  const gross = parse(input.grossKg, "Gross weight", 1);
  const tare = parse(input.tareKg, "Tare weight", 1);
  const moisture = parse(input.moisturePct, "Moisture", 1);
  const rate = parse(input.ratePerQuintal, "Rate", 2);

  if (gross.lte(0)) throw new CalculationError("Gross weight must be more than zero");
  if (tare.gte(gross)) throw new CalculationError("Tare weight must be less than gross weight");
  if (moisture.gt(rule.maxPct)) {
    throw new CalculationError(`Moisture above ${rule.maxPct}% cannot be purchased`);
  }
  if (rate.lte(0)) throw new CalculationError("Rate must be more than zero");

  const weighed = gross.minus(tare);
  const excessPoints = D.max(moisture.minus(rule.basePct), 0);
  const deductionPct = excessPoints.times(rule.deductionPctPerPoint);
  const net = weighed.times(new D(1).minus(deductionPct.div(100))).toDecimalPlaces(1);

  if (net.lte(0)) throw new CalculationError("Net weight must be more than zero");

  const amount = net.times(rate).div(100).toDecimalPlaces(2);

  return {
    weighedKg: weighed.toFixed(1),
    moistureDeductionPct: deductionPct.toFixed(2),
    netKg: net.toFixed(1),
    amount: amount.toFixed(2),
  };
}

/** Exact decimal equality for values that arrive as strings or numbers. */
export function decimalEquals(a: DecimalInput, b: DecimalInput): boolean {
  return new D(String(a)).eq(new D(String(b)));
}

/** Sum of money strings, exact. */
export function sumMoney(values: DecimalInput[]): string {
  return values.reduce<Decimal>((total, v) => total.plus(new D(String(v))), new D(0)).toFixed(2);
}
