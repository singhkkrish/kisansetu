import { z } from "zod";
import { CROPS, GRADES } from "@/types/domain";
import { CalculationError, calculateProcurement, decimalEquals } from "@/lib/calculations/procurement";

/** Accepts "12.5" or 12.5 and returns a decimal string with a bounded scale. */
function decimalString(label: string, maxDecimals: number) {
  return z
    .union([z.string(), z.number()])
    .transform((v) => (typeof v === "number" ? String(v) : v.trim()))
    .pipe(
      z
        .string()
        .regex(/^\d+(\.\d+)?$/, `${label} must be a number`)
        .refine(
          (s) => (s.split(".")[1]?.length ?? 0) <= maxDecimals,
          `${label} allows at most ${maxDecimals} decimal place(s)`,
        ),
    );
}

const slipNo = z.string().regex(/^C[0-9]{2}-[0-9]{5,}$/, "Invalid slip number");
const sha256 = z.string().regex(/^[0-9a-f]{64}$/, "Invalid hash");

/** What the operator types in. Net weight and amount are always derived. */
export const procurementInputSchema = z
  .object({
    farmerId: z.uuid(),
    crop: z.enum(CROPS),
    grade: z.enum(GRADES),
    grossKg: decimalString("Gross weight", 1),
    tareKg: decimalString("Tare weight", 1),
    moisturePct: decimalString("Moisture", 1),
    ratePerQuintal: decimalString("Rate", 2),
  })
  .superRefine((value, ctx) => {
    try {
      calculateProcurement(value);
    } catch (error) {
      if (error instanceof CalculationError) {
        ctx.addIssue({ code: "custom", message: error.message });
      } else {
        throw error;
      }
    }
  });
export type ProcurementInput = z.infer<typeof procurementInputSchema>;

/** A finished entry as stored on the device and sent to the server. */
export const entryRecordSchema = z
  .object({
    clientId: z.uuid(),
    slipNo,
    farmerId: z.uuid(),
    centreId: z.uuid(),
    operatorId: z.uuid(),
    crop: z.enum(CROPS),
    grade: z.enum(GRADES),
    grossKg: decimalString("Gross weight", 1),
    tareKg: decimalString("Tare weight", 1),
    moisturePct: decimalString("Moisture", 1),
    netKg: decimalString("Net weight", 1),
    ratePerQuintal: decimalString("Rate", 2),
    amount: decimalString("Amount", 2),
    deviceId: z.string().min(8).max(64),
    deviceRecordedAt: z.iso.datetime({ offset: true }),
    prevHash: sha256.nullable(),
    payloadHash: sha256,
  })
  .superRefine((value, ctx) => {
    try {
      const calc = calculateProcurement(value);
      if (!decimalEquals(calc.netKg, value.netKg)) {
        ctx.addIssue({ code: "custom", path: ["netKg"], message: "Net weight does not follow the deduction rule" });
      }
      if (!decimalEquals(calc.amount, value.amount)) {
        ctx.addIssue({ code: "custom", path: ["amount"], message: "Amount does not match net weight and rate" });
      }
    } catch (error) {
      if (error instanceof CalculationError) {
        ctx.addIssue({ code: "custom", message: error.message });
      } else {
        throw error;
      }
    }
  });
export type EntryRecord = z.infer<typeof entryRecordSchema>;

export const MAX_SYNC_BATCH = 50;

export const syncRequestSchema = z.object({
  deviceId: z.string().min(8).max(64),
  entries: z.array(z.unknown()).min(1).max(MAX_SYNC_BATCH),
});
export type SyncRequest = z.infer<typeof syncRequestSchema>;
