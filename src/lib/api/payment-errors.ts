import { dbErrorResponse, jsonError } from "@/lib/api/http";

/**
 * The payment and dispatch functions raise errors tagged "ks:<reason>". The tag
 * is mapped to a plain message here; any other database error falls back to the
 * generic mapping, so database text is never sent to the browser.
 */
const KNOWN: Record<string, [number, string]> = {
  "ks:no_eligible_entries": [409, "There is nothing to pay for this selection. Entries may already be in a payment run, or the farmers have no verified bank account."],
  "ks:bad_range": [422, "The end date is before the start date"],
  "ks:range_too_long": [422, "Choose a range of at most one year"],
  "ks:no_centres": [422, "Choose at least one centre"],
  "ks:bad_centre": [422, "A selected centre does not exist"],
  "ks:not_found": [404, "Not found"],
  "ks:bad_state": [409, "This is not possible in the current state of the payment run"],
  "ks:not_approved": [409, "Approve the payment run before downloading the bank file"],
  "ks:reason_required": [422, "Please give a reason"],
  "ks:bad_outcome": [422, "Outcome must be paid or failed"],
  "ks:bad_items": [422, "Choose the payments to update"],
  "ks:item_not_processing": [409, "Only payments that were sent to the bank and are not yet settled can be updated"],
  "ks:bad_weight": [422, "Enter a weight above zero"],
  "ks:weight_above_book": [422, "The weighed weight cannot be more than the stock book quantity"],
  "ks:bad_details": [422, "Check the destination and truck number"],
  "ks:bad_time": [422, "The dispatch time must be within the last 48 hours and not in the future"],
  "ks:insufficient_stock": [409, "There is not enough stock at this centre for that quantity"],
};

export function paymentErrorResponse(error: { code?: string; message?: string }) {
  const tag = (error.message ?? "").match(/ks:[a-z_]+/)?.[0];
  const known = tag ? KNOWN[tag] : undefined;
  if (known) return jsonError(known[0], known[1]);
  return dbErrorResponse(error);
}
