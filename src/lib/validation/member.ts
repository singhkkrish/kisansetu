import { z } from "zod";
import { CROPS } from "@/types/domain";
import {
  PERSON_NAME_PATTERN,
  bankDetailsSchema,
  bankUpdateSchema,
} from "@/lib/validation/bank";

// Every object here is strict, so an unexpected key (an Aadhaar number, say) is
// rejected instead of being silently dropped or passed on.

const fullName = z
  .string()
  .trim()
  .min(2, "Enter the farmer's full name")
  .max(80, "Name is too long")
  .regex(PERSON_NAME_PATTERN, "Name can contain letters, spaces and . ' - only");

const village = z
  .string()
  .trim()
  .min(2, "Enter the village")
  .max(60, "Village name is too long")
  .regex(/^[\p{L}\p{M}][\p{L}\p{M}0-9 .'-]*$/u, "Village can contain letters, digits, spaces and . ' - only");

/** Optional Indian mobile number. Accepts +91 or a leading 0, stores 10 digits or null. */
const phone = z
  .preprocess((value) => value ?? "", z.string())
  .pipe(
    z
      .string()
      .trim()
      .transform((value) => value.replace(/[\s-]/g, "").replace(/^(\+91|91|0)(?=\d{10}$)/, ""))
      .pipe(z.string().regex(/^([6-9]\d{9})?$/, "Enter a 10-digit mobile number starting with 6, 7, 8 or 9")),
  )
  .transform((value) => (value === "" ? null : value));

/** Acres as a decimal string with at most two places. */
const landAcres = z
  .union([z.string(), z.number()])
  .transform((value) => String(value).trim())
  .pipe(
    z
      .string()
      .regex(/^\d{1,3}(\.\d{1,2})?$/, "Enter the land area in acres, up to 2 decimal places")
      .refine((value) => Number(value) > 0, "Land area must be more than 0")
      .refine((value) => Number(value) <= 500, "Land area cannot be more than 500 acres"),
  );

const crops = z
  .array(z.enum(CROPS, "Choose soybean, tur or both"))
  .min(1, "Select at least one crop")
  .refine((list) => new Set(list).size === list.length, "Each crop can be listed once");

const editableFields = {
  fullName,
  village,
  centreId: z.uuid("Choose a centre"),
  phone,
  landAcres,
  crops,
  active: z.boolean().default(true),
};

export const memberCreateSchema = z.strictObject({
  ...editableFields,
  // DPDP Act 2023: processing a member's data needs their recorded consent.
  consentConfirmed: z.literal(true, "Confirm that the member has agreed to the use of their data"),
  bank: bankDetailsSchema.optional(),
});

export const memberUpdateSchema = z.strictObject({
  ...editableFields,
  bank: bankUpdateSchema.optional(),
});

export type MemberCreateInput = z.infer<typeof memberCreateSchema>;
export type MemberUpdateInput = z.infer<typeof memberUpdateSchema>;

/** First message per field, keyed by dotted path ("bank.ifsc"), for form display. */
export function issuesToFieldErrors(error: z.ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "form";
    if (!(key in fieldErrors)) fieldErrors[key] = issue.message;
  }
  return fieldErrors;
}

/** Payload for the register_farmer / update_farmer database functions. */
export function toFarmerPayload(input: MemberCreateInput | MemberUpdateInput) {
  return {
    full_name: input.fullName,
    village: input.village,
    centre_id: input.centreId,
    phone: input.phone,
    land_acres: input.landAcres,
    crops: input.crops,
    active: input.active,
    ...(input.bank
      ? {
          bank: {
            holder_name: input.bank.holderName,
            account_number: input.bank.accountNumber ?? "",
            ifsc: input.bank.ifsc,
          },
        }
      : {}),
  };
}
