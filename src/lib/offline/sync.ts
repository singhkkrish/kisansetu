import type { LocalDatabase } from "@/lib/db/local";
import { markSyncSucceeded, recordServerTime } from "@/lib/offline/clock";
import { getPendingEntries } from "@/lib/offline/queue";
import type { FlagReason, SyncOutcome } from "@/types/domain";

export interface SyncItemResult {
  clientId: string;
  outcome: SyncOutcome;
  slipNo?: string;
  /** The server's own clock at the moment it stored the entry. */
  serverReceivedAt?: string;
  reason?: string;
  flagReasons?: FlagReason[];
}

export interface SyncSummary {
  attempted: number;
  accepted: number;
  duplicates: number;
  flagged: number;
  rejected: number;
  /** Set when syncing stopped early, e.g. no network or signed out. */
  stoppedBecause?: "offline" | "signed_out" | "server_error" | "busy";
}

export interface SyncOptions {
  deviceId: string;
  /** Only this operator's entries are sent, so a shared phone never mixes people. */
  operatorId?: string;
  batchSize?: number;
  endpoint?: string;
  fetchImpl?: typeof fetch;
}

const EMPTY: SyncSummary = { attempted: 0, accepted: 0, duplicates: 0, flagged: 0, rejected: 0 };

/**
 * Sends queued entries to the server, oldest first, in small batches.
 * Safe to call repeatedly: the server treats a repeated clientId as a duplicate,
 * so a response lost on a flaky connection never creates a second purchase.
 */
export async function syncPending(db: LocalDatabase, options: SyncOptions): Promise<SyncSummary> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!locks) return runSync(db, options);

  // One sync at a time across tabs: two tabs sending the same batch would only
  // produce duplicates the server has to discard.
  const outcome = await locks.request("kisansetu-sync", { ifAvailable: true }, async (lock) =>
    lock ? runSync(db, options) : null,
  );
  return outcome ?? { ...EMPTY, stoppedBecause: "busy" };
}

/** Seconds to wait before the Nth automatic retry: 2s, 4s, 8s ... capped at 5 minutes. */
export function retryDelayMs(failedAttempts: number, jitter = Math.random()): number {
  const base = Math.min(300_000, 2_000 * 2 ** Math.max(0, failedAttempts - 1));
  return Math.round(base * (0.8 + 0.4 * jitter));
}

/**
 * Puts entries the server turned away back in the queue, for a manual retry
 * once the cause is fixed. Their data is unchanged, so the server will still
 * recognise them by clientId and can never store one twice.
 */
export async function retryFailedEntries(db: LocalDatabase, operatorId?: string): Promise<number> {
  const failed = (await db.entries.where("syncStatus").equals("rejected").toArray()).filter(
    (e) => !operatorId || e.operatorId === operatorId,
  );
  await db.entries.bulkUpdate(
    failed.map((e) => ({
      key: e.seq!,
      changes: { syncStatus: "pending" as const, syncAttempts: 0, lastError: undefined, nextRetryAt: undefined },
    })),
  );
  return failed.length;
}

async function runSync(db: LocalDatabase, options: SyncOptions): Promise<SyncSummary> {
  const batchSize = options.batchSize ?? 25;
  const endpoint = options.endpoint ?? "/api/sync";
  const doFetch = options.fetchImpl ?? fetch;
  const summary: SyncSummary = { ...EMPTY };

  for (;;) {
    const batch = await getPendingEntries(db, batchSize, options.operatorId);
    if (batch.length === 0) {
      if (!summary.stoppedBecause && summary.attempted > 0) await markSyncSucceeded(db);
      return summary;
    }

    let response: Response;
    const sentAt = Date.now();
    try {
      response = await doFetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceId: options.deviceId,
          entries: batch.map(toWireEntry),
        }),
      });
    } catch {
      await noteFailure(db, batch, "no_connection");
      summary.stoppedBecause = "offline";
      return summary;
    }

    if (response.status === 401) {
      summary.stoppedBecause = "signed_out";
      return summary;
    }
    if (!response.ok) {
      await noteFailure(db, batch, `server_error_${response.status}`);
      summary.stoppedBecause = "server_error";
      return summary;
    }

    const body = (await response.json()) as { results: SyncItemResult[]; serverTime?: string };
    const { results } = body;
    if (body.serverTime) {
      // Midpoint of the round trip is the fairest guess for when the server answered.
      await recordServerTime(db, body.serverTime, new Date((sentAt + Date.now()) / 2));
    }
    const byClientId = new Map(results.map((r) => [r.clientId, r]));
    summary.attempted += batch.length;

    let progressed = false;
    await db.transaction("rw", db.entries, async () => {
      for (const entry of batch) {
        const result = byClientId.get(entry.clientId);
        if (!result) {
          await db.entries.update(entry.seq!, { syncAttempts: entry.syncAttempts + 1 });
          continue;
        }
        progressed = true;
        switch (result.outcome) {
          case "accepted":
            summary.accepted++;
            await db.entries.update(entry.seq!, {
              syncStatus: "synced",
              lastError: undefined,
              nextRetryAt: undefined,
              ...(result.serverReceivedAt ? { serverReceivedAt: result.serverReceivedAt } : {}),
            });
            break;
          case "duplicate":
            summary.duplicates++;
            await db.entries.update(entry.seq!, {
              syncStatus: "synced",
              lastError: undefined,
              nextRetryAt: undefined,
              ...(result.serverReceivedAt ? { serverReceivedAt: result.serverReceivedAt } : {}),
            });
            break;
          case "flagged":
            summary.flagged++;
            await db.entries.update(entry.seq!, {
              syncStatus: "synced",
              flagged: true,
              lastError: undefined,
              nextRetryAt: undefined,
              ...(result.serverReceivedAt ? { serverReceivedAt: result.serverReceivedAt } : {}),
            });
            break;
          case "rejected":
            summary.rejected++;
            await db.entries.update(entry.seq!, {
              syncStatus: "rejected",
              lastError: result.reason ?? "rejected",
            });
            break;
        }
      }
    });

    // The server answered but recognised none of our entries: stop rather than loop.
    if (!progressed) {
      summary.stoppedBecause = "server_error";
      return summary;
    }
  }
}

/** Only the fields the server needs; local bookkeeping stays on the phone. */
function toWireEntry(e: Awaited<ReturnType<typeof getPendingEntries>>[number]) {
  return {
    clientId: e.clientId,
    slipNo: e.slipNo,
    farmerId: e.farmerId,
    centreId: e.centreId,
    operatorId: e.operatorId,
    crop: e.crop,
    grade: e.grade,
    grossKg: e.grossKg,
    tareKg: e.tareKg,
    moisturePct: e.moisturePct,
    netKg: e.netKg,
    ratePerQuintal: e.ratePerQuintal,
    amount: e.amount,
    deviceId: e.deviceId,
    deviceRecordedAt: e.deviceRecordedAt,
    prevHash: e.prevHash,
    clockOffsetMs: e.clockOffsetMs ?? null,
    rateDate: e.rateDate ?? null,
    rateVersion: e.rateVersion ?? null,
    payloadHash: e.payloadHash,
  };
}

async function noteFailure(db: LocalDatabase, batch: { seq?: number; syncAttempts: number }[], why: string) {
  const now = Date.now();
  await db.entries.bulkUpdate(
    batch.map((e) => ({
      key: e.seq!,
      changes: {
        syncAttempts: e.syncAttempts + 1,
        lastError: why,
        nextRetryAt: now + retryDelayMs(e.syncAttempts + 1),
      },
    })),
  );
}
