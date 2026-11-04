import type { CachedMember, LocalEntry } from "@/lib/db/local";
import type { SlipInput } from "@/lib/slip/slip";

/**
 * Builds a slip from an entry stored on the phone, so a slip can be shown and
 * printed with no network and before the entry has synced. Everything on it is
 * the entry's own saved snapshot: the rate shown is the rate it was recorded
 * with, even if a newer one has been published since.
 *
 * Payment is always "not paid yet" here: nothing can have been paid for an
 * entry recorded moments ago, and the phone is never told otherwise.
 */
export function localEntryToSlip(
  entry: LocalEntry,
  member: CachedMember | undefined,
  centre: { code: string; name?: string },
): SlipInput {
  return {
    slipNo: entry.slipNo,
    farmerName: member?.fullName ?? "—",
    farmerCode: member?.memberCode ?? "—",
    village: member?.village ?? "—",
    centreName: centre.name ?? centre.code,
    centreCode: centre.code,
    crop: entry.crop,
    grade: entry.grade,
    grossKg: entry.grossKg,
    tareKg: entry.tareKg,
    moisturePct: entry.moisturePct,
    ratePerQuintal: entry.ratePerQuintal,
    netKg: entry.netKg,
    amount: entry.amount,
    rateDate: entry.rateDate ?? null,
    rateVersion: entry.rateVersion ?? null,
    recordedAt: entry.deviceRecordedAt,
    serverReceivedAt: entry.serverReceivedAt ?? null,
    paymentStatus: "unpaid",
  };
}
