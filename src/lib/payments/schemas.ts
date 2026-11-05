import { z } from "zod";
import { CROPS } from "@/types/domain";

const date = z.iso.date();

export const createRunSchema = z
  .strictObject({
    from: date,
    to: date,
    centreIds: z.array(z.uuid()).min(1).max(100),
  })
  .refine((v) => v.to >= v.from, { message: "End date is before the start date", path: ["to"] });

export const cancelRunSchema = z.strictObject({ reason: z.string().trim().min(5).max(300) });

export const simulateSchema = z
  .strictObject({
    itemIds: z.array(z.uuid()).min(1).max(500),
    outcome: z.enum(["paid", "failed"]),
    reason: z.string().trim().max(200).optional(),
  })
  .refine((v) => v.outcome === "paid" || (v.reason ?? "").length >= 3, {
    message: "Choose or write a reason for the failure",
    path: ["reason"],
  });

/** Weights are kilograms with at most one decimal place, as everywhere else in the app. */
const weight = z
  .union([z.string(), z.number()])
  .transform((v) => (typeof v === "number" ? String(v) : v.trim()))
  .pipe(z.string().regex(/^\d{1,9}(\.\d)?$/, "Enter the weight in kg, with at most one decimal"))
  .refine((v) => Number(v) > 0, "Weight must be more than zero");

export const TRUCK_PATTERN = /^[A-Z0-9]{6,12}$/;

export const dispatchSchema = z.strictObject({
  centreId: z.uuid(),
  crop: z.enum(CROPS),
  weightKg: weight,
  /** Stock book quantity. Defaults to the weighed weight when there is no loss to record. */
  bookKg: weight.optional(),
  destination: z.string().trim().min(2, "Enter the destination").max(120),
  truckNo: z
    .string()
    .transform((v) => v.toUpperCase().replace(/[\s-]/g, ""))
    .pipe(z.string().regex(TRUCK_PATTERN, "Truck number looks wrong (for example MH24AB1234)")),
  dispatchedAt: z.iso.datetime({ offset: true }).optional(),
});
export type DispatchInput = z.infer<typeof dispatchSchema>;
