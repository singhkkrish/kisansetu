/** Reduces what a person typed to a 10-digit Indian mobile number, or null if it is not one. */
export function normalizeIndianMobile(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[\s-]/g, "").replace(/^(\+91|91|0)(?=\d{10}$)/, "");
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

/**
 * "9876543210" -> "+91 98****3210". This is the only form of the number that is
 * ever written to the SMS log or shown in the interface.
 */
export function maskPhone(mobile: string): string {
  const digits = normalizeIndianMobile(mobile);
  if (!digits) return "****";
  return `+91 ${digits.slice(0, 2)}****${digits.slice(-4)}`;
}
