import type { EntryRecord } from "@/lib/validation/procurement";

/**
 * Tamper evidence for entries recorded offline.
 *
 * Each entry's hash covers its purchase facts plus the hash of the previous
 * entry from the same device, forming a chain. Editing an entry, deleting one
 * from the middle, or re-ordering them breaks the chain, and the server
 * recomputes every hash on sync. This makes tampering detectable; it does not
 * stop someone who controls the whole device from rewriting an entire chain,
 * which is why the server also records its own receive time and flags clock
 * anomalies for review.
 */

export type HashableEntry = Omit<EntryRecord, "payloadHash">;

/** Fields covered by the hash, in a fixed order. */
const HASHED_FIELDS = [
  "clientId",
  "slipNo",
  "farmerId",
  "centreId",
  "operatorId",
  "crop",
  "grade",
  "grossKg",
  "tareKg",
  "moisturePct",
  "netKg",
  "ratePerQuintal",
  "amount",
  "deviceId",
  "deviceRecordedAt",
  "prevHash",
] as const satisfies readonly (keyof HashableEntry)[];

/** Deterministic JSON: object keys are emitted in the order given. */
export function canonicalPayload(entry: HashableEntry): string {
  const ordered: Record<string, unknown> = {};
  for (const field of HASHED_FIELDS) {
    ordered[field] = entry[field] ?? null;
  }
  return JSON.stringify(ordered);
}

export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function computePayloadHash(entry: HashableEntry): Promise<string> {
  return sha256Hex(canonicalPayload(entry));
}

export async function verifyPayloadHash(entry: EntryRecord): Promise<boolean> {
  const { payloadHash, ...rest } = entry;
  return (await computePayloadHash(rest)) === payloadHash;
}

/**
 * Checks that a device's entries, oldest first, link up: each prevHash must be
 * the previous entry's payloadHash. Returns the index of the first break, or
 * -1 when the chain is intact. `startingPrevHash` is the hash the first entry
 * is expected to point at (null for a device's very first entry).
 */
export function findChainBreak(
  entries: Pick<EntryRecord, "prevHash" | "payloadHash">[],
  startingPrevHash: string | null,
): number {
  let expected = startingPrevHash;
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].prevHash !== expected) return i;
    expected = entries[i].payloadHash;
  }
  return -1;
}

/** Small allowance for phones whose clocks run a little fast. */
export const DEFAULT_MAX_FUTURE_SKEW_MINUTES = 10;

/**
 * An offline entry is allowed to be old (centres lose network for hours), but
 * it cannot have been recorded in the future. Returns true when the device
 * clock is ahead of the server by more than the allowance.
 */
export function isClockAhead(
  deviceRecordedAtIso: string,
  serverNow: Date,
  maxFutureSkewMinutes = DEFAULT_MAX_FUTURE_SKEW_MINUTES,
): boolean {
  const deviceMs = new Date(deviceRecordedAtIso).getTime();
  if (Number.isNaN(deviceMs)) return true;
  return deviceMs - serverNow.getTime() > maxFutureSkewMinutes * 60_000;
}
