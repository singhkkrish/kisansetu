import { z } from "zod";
import { CROPS, GRADES, type Crop, type Grade } from "@/types/domain";

/** A price may be set for today or up to this many days ahead. Never for a past date. */
export const MAX_DAYS_AHEAD = 14;

export type PriceStatus = "draft" | "published" | "superseded";

export type EffectiveDateProblem = "invalid" | "past" | "too_far";

/** Adds whole days to a YYYY-MM-DD date without touching a time zone. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/**
 * The effective-date rule, mirrored by the database function that actually
 * enforces it. `todayIst` is the current date in India, not the browser's.
 */
export function effectiveDateProblem(date: string, todayIst: string): EffectiveDateProblem | null {
  if (!isRealDate(date)) return "invalid";
  if (date < todayIst) return "past";
  if (date > addDays(todayIst, MAX_DAYS_AHEAD)) return "too_far";
  return null;
}

export const priceRate = z
  .union([z.string(), z.number()])
  .transform((v) => (typeof v === "number" ? String(v) : v.trim()))
  .pipe(
    z
      .string()
      .regex(/^\d{1,5}(\.\d{1,2})?$/, "Enter a rate such as 4850 or 4850.50")
      .refine((s) => Number(s) > 0, "Rate must be more than zero"),
  );

const isoDate = z.string().refine(isRealDate, "Enter a valid date");

export const priceRowSchema = z.strictObject({
  crop: z.enum(CROPS),
  grade: z.enum(GRADES),
  rate: priceRate,
});

/** Save a day's board as drafts. A reason is only needed when it corrects a published rate. */
export const saveDraftsSchema = z.strictObject({
  date: isoDate,
  rows: z.array(priceRowSchema).min(1, "Enter at least one rate").max(CROPS.length * GRADES.length),
  reason: z.string().trim().max(300).optional(),
});
export type SaveDraftsInput = z.infer<typeof saveDraftsSchema>;

export const updateDraftSchema = z.strictObject({ rate: priceRate });

/** `confirm` must be literally true: publishing is never a side effect of another request. */
export const publishSchema = z.strictObject({
  ids: z.array(z.uuid()).min(1, "Choose at least one price").max(CROPS.length * GRADES.length),
  confirm: z.literal(true),
});

export interface PriceVersion {
  id: string;
  priceDate: string;
  crop: Crop;
  grade: Grade;
  version: number;
  rate: string;
  status: PriceStatus;
  createdByName: string | null;
  createdAt: string;
  publishedByName: string | null;
  publishedAt: string | null;
  correctionReason: string | null;
}

export interface BoardSlot {
  crop: Crop;
  grade: Grade;
  /** The live published version, if any. */
  published: PriceVersion | null;
  /** The working draft, if any. */
  draft: PriceVersion | null;
}

/** One slot per crop and grade for the chosen date, from that date's version rows. */
export function buildBoard(versions: PriceVersion[], date: string): BoardSlot[] {
  const slots: BoardSlot[] = [];
  for (const crop of CROPS) {
    for (const grade of GRADES) {
      const rows = versions.filter((v) => v.priceDate === date && v.crop === crop && v.grade === grade);
      slots.push({
        crop,
        grade,
        published: rows.find((v) => v.status === "published") ?? null,
        draft: rows.find((v) => v.status === "draft") ?? null,
      });
    }
  }
  return slots;
}

export type SlotState = "empty" | "draft" | "published" | "correction";

export function slotState(slot: BoardSlot): SlotState {
  if (slot.draft && slot.published) return "correction";
  if (slot.draft) return "draft";
  if (slot.published) return "published";
  return "empty";
}

/** Drafts waiting to be published, in board order. */
export function pendingDrafts(slots: BoardSlot[]): BoardSlot[] {
  return slots.filter((s) => s.draft !== null);
}

/** Only an unpublished price can be edited; this is the single rule the UI follows. */
export function isEditable(status: PriceStatus): boolean {
  return status === "draft";
}
