import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { tryCalculate } from "@/lib/calculations/procurement";
import { LocalDatabase } from "@/lib/db/local";
import { businessDate, getClockOffset, getLastSyncAt, recordServerTime } from "@/lib/offline/clock";
import {
  WrongCentreSlipBlockError,
  countByStatus,
  getOrCreateDeviceId,
  recordProcurement,
  setSlipBlock,
} from "@/lib/offline/queue";
import {
  clearReferenceData,
  downloadReferenceData,
  getCachedRate,
  searchCachedMembers,
  type BootstrapPage,
} from "@/lib/offline/reference-data";
import { retryDelayMs, retryFailedEntries, syncPending } from "@/lib/offline/sync";
import { processSyncBatch, type SyncContext } from "@/lib/services/sync-service";
import { IDS } from "./helpers";
import { MemoryRepo } from "./memory-repo";

let counter = 0;
const open = (name: string) => new LocalDatabase(name, { indexedDB, IDBKeyRange });
function freshName() {
  counter += 1;
  return `kisansetu-engine-${counter}`;
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

async function ready(name = freshName()) {
  const db = open(name);
  const deviceId = await getOrCreateDeviceId(db);
  await setSlipBlock(db, { centreCode: "C07", start: 24518, end: 24530 });
  // A fixed morning on the day the in-memory server has a published rate for.
  const now = new Date("2026-11-02T01:00:00.000Z");
  return { db, name, deviceId, ctx: { operatorId: IDS.operator, centreId: IDS.centre, centreCode: "C07", deviceId, now } };
}

/** A fetch that talks to the real sync service over an in-memory repository. */
function serverFor(repo: MemoryRepo, deviceId: string, opts: { loseResponses?: number; down?: boolean } = {}) {
  const ctx: SyncContext = {
    operatorId: IDS.operator,
    centreId: IDS.centre,
    centreCode: "C07",
    deviceId,
    now: new Date("2026-11-02T10:00:00.000Z"),
    maxFutureSkewMinutes: 10,
  };
  let lose = opts.loseResponses ?? 0;
  const calls: unknown[][] = [];
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    if (opts.down) throw new TypeError("network down");
    const body = JSON.parse(String(init.body));
    calls.push(body.entries);
    const results = await processSyncBatch(body.entries, ctx, repo);
    if (lose > 0) {
      lose -= 1;
      throw new TypeError("connection dropped after the server stored the data");
    }
    return new Response(JSON.stringify({ results, serverTime: repo.serverNow }), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe("tryCalculate: invalid weights and negative amounts", () => {
  const base = { crop: "soybean" as const, grossKg: "860.0", tareKg: "12.0", moisturePct: "14.0", ratePerQuintal: "4850" };

  it("returns the figures for good input", () => {
    expect(tryCalculate(base)).toEqual({
      ok: true,
      result: { weighedKg: "848.0", moistureDeductionPct: "2.00", netKg: "831.0", amount: "40303.50" },
    });
  });

  it.each([
    ["negative gross weight", { grossKg: "-5" }],
    ["tare equal to gross", { tareKg: "860.0" }],
    ["tare above gross (would give a negative net weight)", { tareKg: "900.0" }],
    ["zero gross weight", { grossKg: "0" }],
    ["more than one decimal in a weight", { grossKg: "860.55" }],
    ["text in a weight", { grossKg: "abc" }],
    ["a negative moisture reading", { moisturePct: "-1" }],
    ["a negative rate (would give a negative amount)", { ratePerQuintal: "-4850" }],
    ["a zero rate", { ratePerQuintal: "0" }],
    ["moisture too high to buy", { moisturePct: "31" }],
  ])("refuses %s", (_label, override) => {
    const attempt = tryCalculate({ ...base, ...override });
    expect(attempt.ok).toBe(false);
  });

  it("never produces a negative amount for any accepted input", () => {
    for (const gross of ["1.0", "50.5", "1250.0"]) {
      for (const moisture of ["0", "12", "20.5", "30"]) {
        const attempt = tryCalculate({ ...base, grossKg: gross, tareKg: "0.5", moisturePct: moisture });
        if (attempt.ok) expect(Number(attempt.result.amount)).toBeGreaterThan(0);
      }
    }
  });
});

describe("saving offline", () => {
  it("keeps an entry after the app is closed and reopened", async () => {
    const { db, name, ctx } = await ready();
    const saved = await recordProcurement(db, input, ctx);
    db.close();

    const reopened = open(name);
    const rows = await reopened.entries.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ clientId: saved.clientId, slipNo: "C07-24518", syncStatus: "pending", netKg: "831.0", amount: "40303.50" });
    expect(await countByStatus(reopened)).toEqual({ pending: 1, synced: 0, failed: 0 });
  });

  it("lets the operator keep entering while offline, with unique ascending slip numbers", async () => {
    const { db, ctx } = await ready();
    const slips: string[] = [];
    for (let i = 0; i < 4; i++) slips.push((await recordProcurement(db, input, ctx)).slipNo);
    expect(slips).toEqual(["C07-24518", "C07-24519", "C07-24520", "C07-24521"]);
  });

  it("returns the same entry when Save is tapped twice with the same draft id", async () => {
    const { db, ctx } = await ready();
    const clientId = crypto.randomUUID();
    const first = await recordProcurement(db, input, { ...ctx, clientId });
    const second = await recordProcurement(db, input, { ...ctx, clientId });
    expect(second.clientId).toBe(first.clientId);
    expect(second.slipNo).toBe(first.slipNo);
    expect(await db.entries.count()).toBe(1);
  });

  it("survives two saves of the same draft racing each other", async () => {
    const { db, ctx } = await ready();
    const clientId = crypto.randomUUID();
    await Promise.all([
      recordProcurement(db, input, { ...ctx, clientId }),
      recordProcurement(db, input, { ...ctx, clientId }),
    ]);
    expect(await db.entries.count()).toBe(1);
  });

  it("refuses slip numbers that belong to another centre", async () => {
    const { db, ctx } = await ready();
    await expect(recordProcurement(db, input, { ...ctx, centreCode: "C12" })).rejects.toBeInstanceOf(WrongCentreSlipBlockError);
    expect(await db.entries.count()).toBe(0);
  });

  it("marks the entry with the phone's measured clock offset", async () => {
    const { db, ctx } = await ready();
    await recordServerTime(db, "2026-11-02T10:30:00.000Z", new Date("2026-11-02T10:00:00.000Z"));
    const entry = await recordProcurement(db, input, ctx);
    expect(entry.clockOffsetMs).toBe(30 * 60 * 1000);
  });
});

describe("synchronising", () => {
  it("shows an entry as synced only after the server confirmed it, with the server's own timestamp", async () => {
    const { db, deviceId, ctx } = await ready();
    const repo = new MemoryRepo();
    const entry = await recordProcurement(db, input, { ...ctx, now: new Date("2026-11-02T05:00:00.000Z") });
    expect((await db.entries.get(entry.seq!))!.syncStatus).toBe("pending");

    const { fetchImpl } = serverFor(repo, deviceId);
    const summary = await syncPending(db, { deviceId, fetchImpl });
    expect(summary.accepted).toBe(1);

    const stored = (await db.entries.get(entry.seq!))!;
    expect(stored.syncStatus).toBe("synced");
    // The phone's claimed time and the server's time are kept separately.
    expect(stored.deviceRecordedAt).toBe("2026-11-02T05:00:00.000Z");
    expect(stored.serverReceivedAt).toBe(repo.serverNow);
    expect(stored.serverReceivedAt).not.toBe(stored.deviceRecordedAt);
    expect(await getLastSyncAt(db)).not.toBeNull();
  });

  it("stays pending, with the reason kept, while the network is down", async () => {
    const { db, deviceId, ctx } = await ready();
    const entry = await recordProcurement(db, input, ctx);
    const summary = await syncPending(db, { deviceId, fetchImpl: serverFor(new MemoryRepo(), deviceId, { down: true }).fetchImpl });
    const stored = (await db.entries.get(entry.seq!))!;

    expect(summary.stoppedBecause).toBe("offline");
    expect(stored.syncStatus).toBe("pending");
    expect(stored.syncAttempts).toBe(1);
    expect(stored.lastError).toBe("no_connection");
    expect(stored.nextRetryAt).toBeGreaterThan(Date.now());
    expect(await getLastSyncAt(db)).toBeNull();
  });

  it("creates no duplicate when the response is lost and the phone retries", async () => {
    const { db, deviceId, ctx } = await ready();
    const repo = new MemoryRepo();
    await recordProcurement(db, input, ctx);
    const { fetchImpl, calls } = serverFor(repo, deviceId, { loseResponses: 1 });

    const first = await syncPending(db, { deviceId, fetchImpl });
    expect(first.stoppedBecause).toBe("offline");
    expect(repo.entries.size).toBe(1); // the server did store it
    expect((await db.entries.toArray())[0].syncStatus).toBe("pending");

    const second = await syncPending(db, { deviceId, fetchImpl });
    expect(second.duplicates).toBe(1);
    expect(repo.entries.size).toBe(1);
    const stored = (await db.entries.toArray())[0];
    expect(stored.syncStatus).toBe("synced");
    expect(stored.serverReceivedAt).toBe(repo.serverNow);
    expect(calls).toHaveLength(2);
  });

  it("creates no duplicate when the same queue is synced repeatedly", async () => {
    const { db, deviceId, ctx } = await ready();
    const repo = new MemoryRepo();
    for (let i = 0; i < 3; i++) await recordProcurement(db, input, ctx);
    const { fetchImpl } = serverFor(repo, deviceId);

    await syncPending(db, { deviceId, fetchImpl });
    await syncPending(db, { deviceId, fetchImpl });
    expect(repo.entries.size).toBe(3);
    expect(await countByStatus(db)).toEqual({ pending: 0, synced: 3, failed: 0 });
  });

  it("syncs several batches in order and keeps the hash chain intact", async () => {
    const { db, deviceId, ctx } = await ready();
    const repo = new MemoryRepo();
    const now = new Date("2026-11-02T06:00:00.000Z");
    for (let i = 0; i < 5; i++) await recordProcurement(db, input, { ...ctx, now });
    const { fetchImpl, calls } = serverFor(repo, deviceId);

    const summary = await syncPending(db, { deviceId, fetchImpl, batchSize: 2 });
    expect(calls).toHaveLength(3);
    expect(summary.accepted).toBe(5);
    expect([...repo.entries.values()].every((r) => r.flag_reasons.length === 0)).toBe(true);
  });

  it("sends only the signed-in operator's entries", async () => {
    const { db, deviceId, ctx } = await ready();
    await recordProcurement(db, input, ctx);
    await recordProcurement(db, input, { ...ctx, operatorId: "99999999-9999-4999-8999-999999999999" });
    const repo = new MemoryRepo();

    await syncPending(db, { deviceId, operatorId: IDS.operator, fetchImpl: serverFor(repo, deviceId).fetchImpl });
    const rows = await db.entries.orderBy("seq").toArray();
    expect(rows.map((r) => r.syncStatus)).toEqual(["synced", "pending"]);
  });

  it("keeps a rejected entry visible as failed and can retry it", async () => {
    const { db, deviceId, ctx } = await ready();
    const repo = new MemoryRepo();
    repo.farmers.clear(); // server does not know this farmer yet
    await recordProcurement(db, input, { ...ctx, now: new Date("2026-11-02T06:00:00.000Z") });
    const { fetchImpl } = serverFor(repo, deviceId);

    const first = await syncPending(db, { deviceId, fetchImpl });
    expect(first.rejected).toBe(1);
    expect(await countByStatus(db)).toEqual({ pending: 0, synced: 0, failed: 1 });
    expect((await db.entries.toArray())[0].lastError).toBe("unknown_farmer");

    repo.farmers.add(IDS.farmer); // the cause is fixed
    expect(await retryFailedEntries(db)).toBe(1);
    const second = await syncPending(db, { deviceId, fetchImpl });
    expect(second.accepted).toBe(1);
    expect(await countByStatus(db)).toEqual({ pending: 0, synced: 1, failed: 0 });
    expect(repo.entries.size).toBe(1);
  });

  it("holds an entry for review when the phone's date is wrong but never loses it", async () => {
    const { db, deviceId, ctx } = await ready();
    const repo = new MemoryRepo();
    // Phone runs a day fast, and knows it (it measured the offset against the server).
    await recordServerTime(db, "2026-11-02T10:00:00.000Z", new Date("2026-11-03T10:00:00.000Z"));
    await recordProcurement(db, input, { ...ctx, now: new Date("2026-11-03T06:00:00.000Z") });

    const summary = await syncPending(db, { deviceId, fetchImpl: serverFor(repo, deviceId).fetchImpl });
    const stored = [...repo.entries.values()][0];
    // The measured offset corrected the date, so the right day's rate was found...
    expect(stored.flag_reasons).not.toContain("no_price_for_day");
    // ...but a one-day offset is itself suspicious and holds payment.
    expect(stored.flag_reasons).toContain("clock_skew");
    expect(summary.flagged).toBe(1);
  });
});

describe("backoff", () => {
  it("doubles from two seconds and stops at five minutes", () => {
    const at = (n: number) => retryDelayMs(n, 0.5);
    expect([1, 2, 3, 4].map(at)).toEqual([2000, 4000, 8000, 16000]);
    expect(at(20)).toBe(300_000);
  });
});

describe("clock", () => {
  it("uses the corrected date to pick the day's rate", async () => {
    const db = open(freshName());
    // Phone is a day behind the server.
    await recordServerTime(db, "2026-11-03T08:00:00.000Z", new Date("2026-11-02T08:00:00.000Z"));
    expect((await getClockOffset(db))!.offsetMs).toBe(86_400_000);
    expect(await businessDate(db, new Date("2026-11-02T08:00:00.000Z"))).toBe("2026-11-03");
  });

  it("ignores a server time it cannot read", async () => {
    const db = open(freshName());
    expect(await recordServerTime(db, "not a date")).toBeNull();
  });
});

describe("downloaded farmers and rates", () => {
  const farmers = [
    { id: IDS.farmer, memberCode: "FM00101", fullName: "Sunil Jadhav", village: "Ganjur", phone: null, landAcres: 6, centreId: IDS.centre, crops: ["soybean"] as const },
    { id: "11111111-1111-4111-8111-111111111112", memberCode: "FM00102", fullName: "Kamal Shinde", village: "Ganjur", phone: null, landAcres: 4, centreId: IDS.centre, crops: ["soybean", "tur"] as const },
    { id: "11111111-1111-4111-8111-111111111113", memberCode: "FM00203", fullName: "Mohan Biradar", village: "Murud", phone: null, landAcres: 9, centreId: null, crops: ["tur"] as const },
  ];

  function pagedServer(pages: BootstrapPage[]) {
    let i = 0;
    return (async () => {
      const page = pages[i++];
      if (!page) return new Response("{}", { status: 500 });
      return new Response(JSON.stringify(page), { status: 200 });
    }) as unknown as typeof fetch;
  }

  const prices = [{ priceDate: "2026-11-02", crop: "soybean" as const, grade: "A" as const, ratePerQuintal: "4850.00" }];
  const pages = (): BootstrapPage[] => [
    { members: farmers.slice(0, 2).map((f) => ({ ...f, crops: [...f.crops] })), prices, nextCursor: "FM00102", serverTime: "2026-11-02T10:00:00.000Z" },
    { members: farmers.slice(2).map((f) => ({ ...f, crops: [...f.crops] })), nextCursor: null, serverTime: "2026-11-02T10:00:01.000Z" },
  ];

  it("downloads every page and then works with no network at all", async () => {
    const db = open(freshName());
    const result = await downloadReferenceData(db, { fetchImpl: pagedServer(pages()) });
    expect(result).toEqual({ members: 3, prices: 1 });

    const offline = (async () => {
      throw new TypeError("offline");
    }) as unknown as typeof fetch;
    void offline; // nothing below touches the network
    expect((await searchCachedMembers(db, "sunil")).map((m) => m.memberCode)).toEqual(["FM00101"]);
    expect((await searchCachedMembers(db, "fm00203")).map((m) => m.fullName)).toEqual(["Mohan Biradar"]);
    expect((await searchCachedMembers(db, "ganjur")).map((m) => m.memberCode)).toEqual(["FM00102", "FM00101"]);
    expect((await searchCachedMembers(db, "ganjur kamal")).map((m) => m.memberCode)).toEqual(["FM00102"]);
    expect(await searchCachedMembers(db, "   ")).toEqual([]);
    expect(await getCachedRate(db, "2026-11-02", "soybean", "A")).toBe("4850.00");
    expect(await getCachedRate(db, "2026-11-02", "tur", "A")).toBeNull();
  });

  it("keeps the old copy when a download fails half way", async () => {
    const db = open(freshName());
    await downloadReferenceData(db, { fetchImpl: pagedServer(pages()) });
    await expect(downloadReferenceData(db, { fetchImpl: pagedServer([pages()[0]]) })).rejects.toThrow();
    expect(await db.members.count()).toBe(3);
  });

  it("keeps unsynced entries when reference data is cleared on sign-out", async () => {
    const { db, ctx } = await ready();
    await downloadReferenceData(db, { fetchImpl: pagedServer(pages()) });
    await recordProcurement(db, input, ctx);
    await clearReferenceData(db);
    expect(await db.members.count()).toBe(0);
    expect(await db.entries.count()).toBe(1);
  });

  it("never stores bank details in the local cache", async () => {
    const db = open(freshName());
    await downloadReferenceData(db, { fetchImpl: pagedServer(pages()) });
    const keys = Object.keys((await db.members.toArray())[0]);
    expect(keys.some((k) => /bank|account|ifsc|aadhaar/i.test(k))).toBe(false);
  });
});
