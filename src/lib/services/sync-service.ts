import { istDate } from "@/lib/calculations/format";
import { decimalEquals } from "@/lib/calculations/procurement";
import { isClockAhead, verifyPayloadHash } from "@/lib/offline/integrity";
import type { SyncItemResult } from "@/lib/offline/sync";
import { entryRecordSchema, type EntryRecord } from "@/lib/validation/procurement";
import type { Crop, FlagReason, Grade } from "@/types/domain";

/** A phone whose clock was this far from the server's is flagged for review. */
export const MAX_CLOCK_OFFSET_MS = 15 * 60 * 1000;

export interface SyncContext {
  operatorId: string;
  centreId: string;
  centreCode: string;
  deviceId: string;
  now: Date;
  maxFutureSkewMinutes: number;
}

export interface EntryRow {
  client_id: string;
  slip_no: string;
  farmer_id: string;
  centre_id: string;
  operator_id: string;
  crop: Crop;
  grade: Grade;
  gross_kg: string;
  tare_kg: string;
  moisture_pct: string;
  net_kg: string;
  rate_per_quintal: string;
  amount: string;
  device_id: string;
  device_recorded_at: string;
  device_clock_offset_ms: number | null;
  rate_price_date: string | null;
  rate_version: number | null;
  payload_hash: string;
  prev_hash: string | null;
  sync_status: "synced";
  approval_status: "approved" | "held";
  flag_reasons: FlagReason[];
}

export type InsertResult = "inserted" | "duplicate_client" | "duplicate_slip";

/**
 * What the database actually stored. The server decides the receive time and the
 * final flags itself, so the outcome reported to the phone comes from here and
 * not from what the application predicted.
 */
export interface InsertOutcome {
  status: InsertResult;
  serverReceivedAt?: string;
  flagReasons?: FlagReason[];
}

/** Storage the sync service needs. Implemented over Supabase in sync-repository.ts. */
export interface SyncRepository {
  findEntryByClientId(
    clientId: string,
  ): Promise<{ payloadHash: string; serverReceivedAt?: string } | null>;
  isKnownHash(deviceId: string, hash: string): Promise<boolean>;
  farmerExists(farmerId: string): Promise<boolean>;
  getRate(date: string, crop: Crop, grade: Grade): Promise<string | null>;
  insertEntry(row: EntryRow): Promise<InsertOutcome>;
  logEvent(event: {
    deviceId: string;
    operatorId: string;
    clientId: string | null;
    outcome: SyncItemResult["outcome"];
    detail: Record<string, unknown>;
  }): Promise<void>;
}

function clientIdOf(raw: unknown): string | null {
  if (raw && typeof raw === "object" && "clientId" in raw) {
    const id = (raw as { clientId: unknown }).clientId;
    if (typeof id === "string") return id;
  }
  return null;
}

/**
 * Processes one device's batch in order. Each entry is judged on its own: a bad
 * entry is rejected without blocking the ones after it, and an anomaly holds
 * payment for review but never cancels the purchase.
 */
export async function processSyncBatch(
  rawEntries: unknown[],
  ctx: SyncContext,
  repo: SyncRepository,
): Promise<SyncItemResult[]> {
  const results: SyncItemResult[] = [];
  // Hashes seen earlier in this batch, so a chain can span entries sent together.
  const seenInBatch = new Set<string>();

  for (const raw of rawEntries) {
    const result = await processOne(raw, ctx, repo, seenInBatch);
    results.push(result);
  }
  return results;
}

async function processOne(
  raw: unknown,
  ctx: SyncContext,
  repo: SyncRepository,
  seenInBatch: Set<string>,
): Promise<SyncItemResult> {
  const fallbackId = clientIdOf(raw);

  const reject = async (
    clientId: string | null,
    reason: string,
    payloadHash?: string,
  ): Promise<SyncItemResult> => {
    if (payloadHash) seenInBatch.add(payloadHash);
    await repo.logEvent({
      deviceId: ctx.deviceId,
      operatorId: ctx.operatorId,
      clientId,
      outcome: "rejected",
      detail: { reason, payloadHash: payloadHash ?? null },
    });
    return { clientId: clientId ?? "unknown", outcome: "rejected", reason };
  };

  const parsed = entryRecordSchema.safeParse(raw);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid entry";
    return reject(fallbackId, `invalid_entry: ${message}`);
  }
  const entry: EntryRecord = parsed.data;

  if (
    entry.operatorId !== ctx.operatorId ||
    entry.centreId !== ctx.centreId ||
    entry.deviceId !== ctx.deviceId ||
    !entry.slipNo.startsWith(`${ctx.centreCode}-`)
  ) {
    return reject(entry.clientId, "entry_does_not_belong_to_this_operator", entry.payloadHash);
  }

  if (!(await verifyPayloadHash(entry))) {
    return reject(entry.clientId, "hash_mismatch", entry.payloadHash);
  }

  // Idempotency: a retried sync must never create a second purchase.
  const existing = await repo.findEntryByClientId(entry.clientId);
  if (existing) {
    if (existing.payloadHash !== entry.payloadHash) {
      return reject(entry.clientId, "client_id_reused_with_different_data", entry.payloadHash);
    }
    seenInBatch.add(entry.payloadHash);
    await repo.logEvent({
      deviceId: ctx.deviceId,
      operatorId: ctx.operatorId,
      clientId: entry.clientId,
      outcome: "duplicate",
      detail: { slipNo: entry.slipNo, payloadHash: entry.payloadHash },
    });
    return {
      clientId: entry.clientId,
      outcome: "duplicate",
      slipNo: entry.slipNo,
      ...(existing.serverReceivedAt ? { serverReceivedAt: existing.serverReceivedAt } : {}),
    };
  }

  if (!(await repo.farmerExists(entry.farmerId))) {
    return reject(entry.clientId, "unknown_farmer", entry.payloadHash);
  }

  const flags = await collectFlags(entry, ctx, repo, seenInBatch);

  const stored = await repo.insertEntry({
    client_id: entry.clientId,
    slip_no: entry.slipNo,
    farmer_id: entry.farmerId,
    centre_id: entry.centreId,
    operator_id: entry.operatorId,
    crop: entry.crop,
    grade: entry.grade,
    gross_kg: entry.grossKg,
    tare_kg: entry.tareKg,
    moisture_pct: entry.moisturePct,
    net_kg: entry.netKg,
    rate_per_quintal: entry.ratePerQuintal,
    amount: entry.amount,
    device_id: entry.deviceId,
    device_recorded_at: entry.deviceRecordedAt,
    device_clock_offset_ms: entry.clockOffsetMs ?? null,
    rate_price_date: entry.rateDate ?? null,
    rate_version: entry.rateVersion ?? null,
    payload_hash: entry.payloadHash,
    prev_hash: entry.prevHash,
    sync_status: "synced",
    approval_status: flags.length > 0 ? "held" : "approved",
    flag_reasons: flags,
  });

  if (stored.status === "duplicate_client") {
    // Lost the race against a parallel retry of the same entry.
    seenInBatch.add(entry.payloadHash);
    await repo.logEvent({
      deviceId: ctx.deviceId,
      operatorId: ctx.operatorId,
      clientId: entry.clientId,
      outcome: "duplicate",
      detail: { slipNo: entry.slipNo, payloadHash: entry.payloadHash },
    });
    return { clientId: entry.clientId, outcome: "duplicate", slipNo: entry.slipNo };
  }
  if (stored.status === "duplicate_slip") {
    return reject(entry.clientId, "slip_number_already_used", entry.payloadHash);
  }

  seenInBatch.add(entry.payloadHash);
  const finalFlags = stored.flagReasons ?? flags;
  const outcome = finalFlags.length > 0 ? "flagged" : "accepted";
  await repo.logEvent({
    deviceId: ctx.deviceId,
    operatorId: ctx.operatorId,
    clientId: entry.clientId,
    outcome,
    detail: { slipNo: entry.slipNo, payloadHash: entry.payloadHash, flags: finalFlags },
  });
  return {
    clientId: entry.clientId,
    outcome,
    slipNo: entry.slipNo,
    ...(stored.serverReceivedAt ? { serverReceivedAt: stored.serverReceivedAt } : {}),
    ...(finalFlags.length > 0 ? { flagReasons: finalFlags } : {}),
  };
}

async function collectFlags(
  entry: EntryRecord,
  ctx: SyncContext,
  repo: SyncRepository,
  seenInBatch: Set<string>,
): Promise<FlagReason[]> {
  const flags: FlagReason[] = [];

  if (isClockAhead(entry.deviceRecordedAt, ctx.now, ctx.maxFutureSkewMinutes)) {
    flags.push("clock_ahead");
  }

  if (entry.prevHash !== null) {
    const known =
      seenInBatch.has(entry.prevHash) || (await repo.isKnownHash(entry.deviceId, entry.prevHash));
    if (!known) flags.push("chain_gap");
  }

  if (Math.abs(entry.clockOffsetMs ?? 0) > MAX_CLOCK_OFFSET_MS) flags.push("clock_skew");

  // The phone's date is only a claim, so it is corrected by the offset the
  // phone itself measured against the server before looking up the day's rate.
  const correctedMs = Date.parse(entry.deviceRecordedAt) + (entry.clockOffsetMs ?? 0);
  const rate = await repo.getRate(istDate(new Date(correctedMs).toISOString()), entry.crop, entry.grade);
  if (rate === null) {
    flags.push("no_price_for_day");
  } else if (!decimalEquals(rate, entry.ratePerQuintal)) {
    flags.push("rate_mismatch");
  }

  return flags;
}
