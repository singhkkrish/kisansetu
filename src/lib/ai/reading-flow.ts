import type { FieldReadingMeta } from "@/lib/ai/schemas";

/**
 * The operator's side of an AI reading, as plain functions so every rule is
 * testable. The AI only ever offers a suggestion: nothing becomes the entry's
 * value until the operator accepts or types it, and a value that differs from
 * the suggestion needs an explicit tick before it can be used.
 */
export type Decision = "undecided" | "accepted" | "corrected" | "rejected";

export interface Suggestion {
  value: string;
  confidence: "high" | "medium";
}

export type BlockReason = "decide" | "value" | "acknowledge";

export interface FieldState {
  /** Present only when the AI gave a usable (not uncertain, not failed) reading. */
  suggestion: Suggestion | null;
  /** True when a photo was sent and the AI could not give a usable value. */
  attemptedWithoutValue: boolean;
  decision: Decision;
  /** What is in the field now. */
  value: string;
  /** The operator ticked "my value differs from the AI reading". */
  acknowledged: boolean;
}

export interface FieldOutcome {
  /** Stored with the entry. Undefined when the AI was not used for this figure. */
  meta: FieldReadingMeta | undefined;
  /** Why the operator cannot move on yet, if they cannot. */
  blocked: BlockReason | null;
}

const normalise = (v: string) => (v.trim() === "" ? "" : Number(v.replace(/\.$/, "")).toFixed(1));

export function sameReading(a: string, b: string): boolean {
  return normalise(a) !== "" && normalise(a) === normalise(b);
}

export function resolveField(state: FieldState): FieldOutcome {
  const { suggestion, decision, value, acknowledged } = state;
  if (!suggestion) {
    return { meta: state.attemptedWithoutValue ? { source: "manual" } : undefined, blocked: null };
  }
  const ai = { aiValue: suggestion.value, aiConfidence: suggestion.confidence } as const;
  if (decision === "undecided") return { meta: undefined, blocked: "decide" };
  if (decision === "rejected") return { meta: { source: "manual", ...ai }, blocked: null };

  if (normalise(value) === "") return { meta: undefined, blocked: "value" };
  if (sameReading(value, suggestion.value)) return { meta: { source: "ai_confirmed", ...ai }, blocked: null };
  if (!acknowledged) return { meta: undefined, blocked: "acknowledge" };
  return { meta: { source: "ai_corrected", ...ai }, blocked: null };
}
