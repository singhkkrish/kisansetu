import { z } from "zod";

/**
 * What the model is asked to return, per kind of display. The server never
 * passes the model's text on as-is: it must satisfy these schemas first.
 */
export const DISPLAY_KINDS = ["scale", "moisture"] as const;
export type DisplayKind = (typeof DISPLAY_KINDS)[number];

const confidence = z.enum(["high", "medium", "low"]);
const problem = z.enum(["none", "blurry", "glare", "dark", "cropped", "not_a_display"]);

export const scaleModelOutputSchema = z.strictObject({
  readable: z.boolean(),
  weight: z.number().finite().nullable(),
  unit: z.enum(["kg", "g", "lb", "quintal", "unknown"]),
  confidence,
  problem,
});
export type ScaleModelOutput = z.infer<typeof scaleModelOutputSchema>;

export const moistureModelOutputSchema = z.strictObject({
  readable: z.boolean(),
  moisture_pct: z.number().finite().nullable(),
  confidence,
  problem,
});
export type MoistureModelOutput = z.infer<typeof moistureModelOutputSchema>;

export const modelOutputSchemas = {
  scale: scaleModelOutputSchema,
  moisture: moistureModelOutputSchema,
} as const;

/** Every reason the AI could not give a usable suggestion. The operator types the value instead. */
export const FAILURE_CODES = [
  "invalid_image",
  "unsupported_format",
  "too_large",
  "poor_quality",
  "timeout",
  "api_error",
  "malformed_response",
  "missing_value",
  "not_configured",
  "rate_limited",
] as const;
export type FailureCode = (typeof FAILURE_CODES)[number];

/** The AI looked and is not sure enough. The value is deliberately withheld. */
export const UNCERTAIN_REASONS = ["low_confidence", "unreadable", "unit_unclear", "implausible"] as const;
export type UncertainReason = (typeof UNCERTAIN_REASONS)[number];

export const readingResultSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("ok"),
    kind: z.enum(DISPLAY_KINDS),
    /** Normalised: kilograms for a scale, per cent for a moisture meter. One decimal. */
    value: z.string().regex(/^\d+(\.\d)?$/),
    displayed: z.strictObject({ value: z.string(), unit: z.string() }),
    confidence: z.enum(["high", "medium"]),
    caution: z.boolean(),
  }),
  z.strictObject({ status: z.literal("uncertain"), kind: z.enum(DISPLAY_KINDS), reason: z.enum(UNCERTAIN_REASONS) }),
  z.strictObject({ status: z.literal("failed"), kind: z.enum(DISPLAY_KINDS).optional(), code: z.enum(FAILURE_CODES) }),
]);
export type ReadingResult = z.infer<typeof readingResultSchema>;

/**
 * How each figure on an entry was obtained. Stored with the entry so a manager
 * can see which values the AI suggested and which the operator changed. It holds
 * no image and no personal data.
 */
export const READING_SOURCES = ["manual", "ai_confirmed", "ai_corrected"] as const;
export type ReadingSource = (typeof READING_SOURCES)[number];

const fieldMeta = z.strictObject({
  source: z.enum(READING_SOURCES),
  aiValue: z.string().regex(/^\d+(\.\d)?$/).optional(),
  aiConfidence: z.enum(["high", "medium"]).optional(),
});
export type FieldReadingMeta = z.infer<typeof fieldMeta>;

export const readingsSchema = z.strictObject({
  grossKg: fieldMeta.optional(),
  tareKg: fieldMeta.optional(),
  moisturePct: fieldMeta.optional(),
});
export type Readings = z.infer<typeof readingsSchema>;
