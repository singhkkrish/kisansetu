import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { LocalDatabase } from "@/lib/db/local";
import {
  SlipBlockExhaustedError,
  countPending,
  getOrCreateDeviceId,
  getPendingEntries,
  recordProcurement,
  setSlipBlock,
  slipNumbersRemaining,
} from "@/lib/offline/queue";
import { syncPending, type SyncItemResult } from "@/lib/offline/sync";
import { findChainBreak, verifyPayloadHash } from "@/lib/offline/integrity";
import { IDS } from "./helpers";

let counter = 0;
function freshDb() {
  counter += 1;
  return new LocalDatabase(`kisansetu-test-${counter}`, { indexedDB, IDBKeyRange });
}

const input = {
  farmerId: IDS.farmer,
  crop: "soybean" as const,
  grade: "A" as const,
  grossKg: "860.0",
  tareKg: "12.0",
  moisturePct: "14.0",
  ratePerQuintal: "4850",
};

async function ready() {
  const db = freshDb();
  const deviceId = await getOrCreateDeviceId(db);
  await setSlipBlock(db, { centreCode: "C07", start: 24518, end: 24520 });
  const ctx = { operatorId: IDS.operator, centreId: IDS.centre, deviceId };
  return { db, deviceId, ctx };
}

describe("recordProcurement", () => {
  it("derives net weight and amount and queues the entry", async () => {
    const { db, ctx } = await ready();
    const entry = await recordProcurement(db, input, ctx);

    expect(entry.slipNo).toBe("C07-24518");
    expect(entry.netKg).toBe("831.0");
    expect(entry.amount).toBe("40303.50");
    expect(entry.syncStatus).toBe("pending");
    expect(await verifyPayloadHash(entry)).toBe(true);
    expect(await countPending(db)).toBe(1);
  });

  it("issues consecutive slip numbers and chains the hashes", async () => {
    const { db, ctx } = await ready();
    const a = await recordProcurement(db, input, ctx);
    const b = await recordProcurement(db, input, ctx);
    const c = await recordProcurement(db, input, ctx);

    expect([a.slipNo, b.slipNo, c.slipNo]).toEqual(["C07-24518", "C07-24519", "C07-24520"]);
    expect(a.prevHash).toBeNull();
    expect(findChainBreak([a, b, c], null)).toBe(-1);
  });

  it("keeps slip numbers unique and the chain intact when two saves happen at once", async () => {
    const { db, ctx } = await ready();
    const [x, y] = await Promise.all([
      recordProcurement(db, input, ctx),
      recordProcurement(db, input, ctx),
    ]);

    expect(new Set([x.slipNo, y.slipNo]).size).toBe(2);
    const rows = await db.entries.orderBy("seq").toArray();
    expect(rows).toHaveLength(2);
    expect(findChainBreak(rows, null)).toBe(-1);
    expect(await slipNumbersRemaining(db)).toBe(1);
  });

  it("stops when the slip block runs out, without queuing anything", async () => {
    const { db, ctx } = await ready();
    for (let i = 0; i < 3; i++) await recordProcurement(db, input, ctx);
    expect(await slipNumbersRemaining(db)).toBe(0);

    await expect(recordProcurement(db, input, ctx)).rejects.toBeInstanceOf(SlipBlockExhaustedError);
    expect(await countPending(db)).toBe(3);
  });

  it("refuses to record without a slip block", async () => {
    const db = freshDb();
    const ctx = { operatorId: IDS.operator, centreId: IDS.centre, deviceId: "dev-test-device-0001" };
    await expect(recordProcurement(db, input, ctx)).rejects.toBeInstanceOf(SlipBlockExhaustedError);
  });

  it("rejects invalid input before touching the queue", async () => {
    const { db, ctx } = await ready();
    await expect(recordProcurement(db, { ...input, tareKg: "900.0" }, ctx)).rejects.toThrow();
    expect(await countPending(db)).toBe(0);
    expect(await slipNumbersRemaining(db)).toBe(3);
  });

  it("keeps the device id stable between calls", async () => {
    const db = freshDb();
    expect(await getOrCreateDeviceId(db)).toBe(await getOrCreateDeviceId(db));
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("syncPending", () => {
  it("marks accepted, flagged and rejected entries from the server response", async () => {
    const { db, deviceId, ctx } = await ready();
    const a = await recordProcurement(db, input, ctx);
    const b = await recordProcurement(db, input, ctx);
    const c = await recordProcurement(db, input, ctx);

    const results: SyncItemResult[] = [
      { clientId: a.clientId, outcome: "accepted" },
      { clientId: b.clientId, outcome: "flagged", flagReasons: ["rate_mismatch"] },
      { clientId: c.clientId, outcome: "rejected", reason: "unknown_farmer" },
    ];
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ results }));

    const summary = await syncPending(db, { deviceId, fetchImpl });
    expect(summary).toMatchObject({ attempted: 3, accepted: 1, flagged: 1, rejected: 1 });

    const rows = await db.entries.orderBy("seq").toArray();
    expect(rows.map((r) => r.syncStatus)).toEqual(["synced", "synced", "rejected"]);
    expect(rows[1].flagged).toBe(true);
    expect(rows[2].lastError).toBe("unknown_farmer");
    expect(await countPending(db)).toBe(0);
  });

  it("sends entries oldest first and without local bookkeeping fields", async () => {
    const { db, deviceId, ctx } = await ready();
    await recordProcurement(db, input, ctx);
    await recordProcurement(db, input, ctx);

    const fetchImpl = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      return jsonResponse({
        results: body.entries.map((e: { clientId: string }) => ({ clientId: e.clientId, outcome: "accepted" })),
      });
    });
    await syncPending(db, { deviceId, fetchImpl });

    const sent = JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string);
    expect(sent.entries.map((e: { slipNo: string }) => e.slipNo)).toEqual(["C07-24518", "C07-24519"]);
    expect(sent.entries[0]).not.toHaveProperty("syncStatus");
    expect(sent.entries[0]).not.toHaveProperty("seq");
  });

  it("leaves everything queued when the network is down", async () => {
    const { db, deviceId, ctx } = await ready();
    await recordProcurement(db, input, ctx);
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

    const summary = await syncPending(db, { deviceId, fetchImpl });
    expect(summary.stoppedBecause).toBe("offline");
    expect(await countPending(db)).toBe(1);
  });

  it("stops quietly when the session has expired", async () => {
    const { db, deviceId, ctx } = await ready();
    await recordProcurement(db, input, ctx);
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: "unauthorised" }, 401));

    const summary = await syncPending(db, { deviceId, fetchImpl });
    expect(summary.stoppedBecause).toBe("signed_out");
    expect(await countPending(db)).toBe(1);
  });

  it("counts a failed attempt on a server error and keeps the entry queued", async () => {
    const { db, deviceId, ctx } = await ready();
    await recordProcurement(db, input, ctx);
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: "boom" }, 500));

    const summary = await syncPending(db, { deviceId, fetchImpl });
    expect(summary.stoppedBecause).toBe("server_error");
    const [row] = await getPendingEntries(db, 10);
    expect(row.syncAttempts).toBe(1);
  });

  it("is safe to retry: a duplicate answer still clears the queue", async () => {
    const { db, deviceId, ctx } = await ready();
    const a = await recordProcurement(db, input, ctx);
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ results: [{ clientId: a.clientId, outcome: "duplicate" }] }));

    const summary = await syncPending(db, { deviceId, fetchImpl });
    expect(summary.duplicates).toBe(1);
    expect(await countPending(db)).toBe(0);
  });

  it("does nothing when there is nothing to send", async () => {
    const { db, deviceId } = await ready();
    const fetchImpl = vi.fn();
    const summary = await syncPending(db, { deviceId, fetchImpl });
    expect(summary.attempted).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
