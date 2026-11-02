import { z } from "zod";

/** Letters from any script (Marathi included), with a few name punctuation marks. */
export const PERSON_NAME_PATTERN = /^[\p{L}\p{M}][\p{L}\p{M}.' -]*$/u;

export const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;

export const ifscSchema = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .pipe(
    z
      .string()
      .regex(IFSC_PATTERN, "IFSC must be 4 letters, a zero, then 6 letters or digits (for example SBIN0001234)"),
  );

/** Accepts spaces or dashes while typing, stores digits only. */
export const accountNumberSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s-]/g, ""))
  .pipe(
    z
      .string()
      .regex(/^\d{9,18}$/, "Account number must be 9 to 18 digits")
      .refine((value) => !/^(\d)\1+$/.test(value), "Account number cannot be a single repeated digit"),
  );

export const holderNameSchema = z
  .string()
  .trim()
  .min(2, "Enter the account holder's name")
  .max(80, "Name is too long")
  .regex(PERSON_NAME_PATTERN, "Name can contain letters, spaces and . ' - only");

/** Bank details for a new account: everything is required. */
export const bankDetailsSchema = z.strictObject({
  holderName: holderNameSchema,
  accountNumber: accountNumberSchema,
  ifsc: ifscSchema,
});

/**
 * Bank details when editing. The stored account number is never sent back to
 * the browser, so leaving it empty means "keep the existing number".
 */
export const bankUpdateSchema = z.strictObject({
  holderName: holderNameSchema,
  accountNumber: z
    .union([z.literal(""), accountNumberSchema])
    .optional()
    .transform((value) => (value ? value : undefined)),
  ifsc: ifscSchema,
});

export type BankDetailsInput = z.infer<typeof bankDetailsSchema>;
export type BankUpdateInput = z.infer<typeof bankUpdateSchema>;

/** "123456789012" -> "XXXXXXXX9012". Only the last four digits are ever shown. */
export function maskAccountNumber(accountNumber: string): string {
  const digits = accountNumber.replace(/\D/g, "");
  if (digits.length <= 4) return "X".repeat(digits.length);
  return "X".repeat(digits.length - 4) + digits.slice(-4);
}
