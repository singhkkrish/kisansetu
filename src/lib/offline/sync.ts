import type { LocalDatabase } from "@/lib/db/local";
import { getPendingEntries } from "@/lib/offline/queue";
import type { FlagReason, SyncOutcome } from "@/types/domain";

export interface SyncItemResult {
  clientId: string;
  outcome: SyncOutcome;
  slipNo?: string;
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
  stoppedBecause?: "offline" | "signed_out" | "server_error";
}

export interface SyncOptions {
  deviceId: string;
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
  const batchSize = options.batchSize ?? 25;
  const endpoint = options.endpoint ?? "/api/sync";
  const doFetch = options.fetchImpl ?? fetch;
  const summary: SyncSummary = { ...EMPTY };

  for (;;) {
    const batch = await getPendingEntries(db, batchSize);
    if (batch.length === 0) return summary;

    let response: Response;
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
      summary.stoppedBecause = "offline";
      return summary;
    }

    if (response.status === 401) {
      summary.stoppedBecause = "signed_out";
      return summary;
    }
    if (!response.ok) {
      await db.entries.bulkUpdate(
        batch.map((e) => ({ key: e.seq!, changes: { syncAttempts: e.syncAttempts + 1 } })),
      );
      summary.stoppedBecause = "server_error";
      return summary;
    }

    const { results } = (await response.json()) as { results: SyncItemResult[] };
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
            await db.entries.update(entry.seq!, { syncStatus: "synced", lastError: undefined });
            break;
          case "duplicate":
            summary.duplicates++;
            await db.entries.update(entry.seq!, { syncStatus: "synced", lastError: undefined });
            break;
          case "flagged":
            summary.flagged++;
            await db.entries.update(entry.seq!, {
              syncStatus: "synced",
              flagged: true,
              lastError: undefined,
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
    payloadHash: e.payloadHash,
  };
}
