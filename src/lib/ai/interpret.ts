import Decimal from "decimal.js";
import {
  modelOutputSchemas,
  type DisplayKind,
  type FailureCode,
  type MoistureModelOutput,
  type ReadingResult,
  type ScaleModelOutput,
  type UncertainReason,
} from "@/lib/ai/schemas";

/**
 * Turns the model's structured answer into a result the operator can act on.
 * Pure and deterministic, so every failure path is testable without the API.
 *
 * Plausibility bounds only catch nonsense (a 90 000 kg bag, 400 % moisture).
 * They are sanity checks on the reading, not agronomic or commercial limits.
 */
const MAX_SCALE_KG = 5000;
const MAX_MOISTURE_PCT = 60;

const KG_PER_UNIT: Record<string, string | undefined> = { kg: "1", g: "0.001", lb: "0.45359237", quintal: "100" };

const failed = (kind: DisplayKind, code: FailureCode): ReadingResult => ({ status: "failed", kind, code });
const uncertain = (kind: DisplayKind, reason: UncertainReason): ReadingResult => ({ status: "uncertain", kind, reason });

function finish(kind: DisplayKind, value: Decimal, displayed: { value: string; unit: string }, confidence: "high" | "medium", max: number): ReadingResult {
  if (value.lte(0) || value.gt(max)) return uncertain(kind, "implausible");
  return {
    status: "ok",
    kind,
    value: value.toDecimalPlaces(1, Decimal.ROUND_HALF_UP).toFixed(1),
    displayed,
    confidence,
    caution: confidence === "medium",
  };
}

function interpretScale(out: ScaleModelOutput): ReadingResult {
  if (!out.readable) return out.problem === "none" ? uncertain("scale", "unreadable") : out.problem === "not_a_display" ? failed("scale", "invalid_image") : failed("scale", "poor_quality");
  if (out.confidence === "low") return uncertain("scale", "low_confidence");
  if (out.weight === null) return failed("scale", "missing_value");
  const factor = KG_PER_UNIT[out.unit];
  if (!factor) return uncertain("scale", "unit_unclear");
  return finish("scale", new Decimal(out.weight).times(factor), { value: String(out.weight), unit: out.unit }, out.confidence, MAX_SCALE_KG);
}

function interpretMoisture(out: MoistureModelOutput): ReadingResult {
  if (!out.readable) return out.problem === "none" ? uncertain("moisture", "unreadable") : out.problem === "not_a_display" ? failed("moisture", "invalid_image") : failed("moisture", "poor_quality");
  if (out.confidence === "low") return uncertain("moisture", "low_confidence");
  if (out.moisture_pct === null) return failed("moisture", "missing_value");
  return finish("moisture", new Decimal(out.moisture_pct), { value: String(out.moisture_pct), unit: "%" }, out.confidence, MAX_MOISTURE_PCT);
}

/** `raw` is whatever the model produced; anything that does not fit the schema is a malformed response. */
export function interpretModelOutput(kind: DisplayKind, raw: unknown): ReadingResult {
  const parsed = modelOutputSchemas[kind].safeParse(raw);
  if (!parsed.success) return failed(kind, "malformed_response");
  return kind === "scale" ? interpretScale(parsed.data as ScaleModelOutput) : interpretMoisture(parsed.data as MoistureModelOutput);
}
