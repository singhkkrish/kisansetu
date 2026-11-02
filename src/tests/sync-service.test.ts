import { beforeEach, describe, expect, it } from "vitest";
import {
  processSyncBatch,
  type EntryRow,
  type InsertResult,
  type SyncContext,
  type SyncRepository,
} from "@/lib/services/sync-service";
import { DEVICE_ID, IDS, makeEntry } from "./helpers";

class MemoryRepo implements SyncRepository {
  entries = new Map<string, EntryRow>();
  events: { outcome: string; detail: Record<string, unknown> }[] = [];
  farmers = new Set<string>([IDS.farmer]);
  prices = new Map<string, string>([["2026-11-02|soybean|A", "4850.00"]]);

  async findEntryByClientId(clientId: string) {
    const row = this.entries.get(clientId);
    return row ? { payloadHash: row.payload_hash } : null;
  }
  async isKnownHash(_deviceId: string, hash: string) {
    return [...this.entries.values()].some((r) => r.payload_hash === hash) ||
      this.events.some((e) => e.detail.payloadHash === hash);
  }
  async farmerExists(id: string) {
    return this.farmers.has(id);
  }
  async getRate(date: string, crop: string, grade: string) {
    return this.prices.get(`${date}|${crop}|${grade}`) ?? null;
  }
  async insertEntry(row: EntryRow): Promise<InsertResult> {
    if (this.entries.has(row.client_id)) return "duplicate_client";
    if ([...this.entries.values()].some((r) => r.slip_no === row.slip_no)) return "duplicate_slip";
    this.entries.set(row.client_id, row);
    return "inserted";
  }
  async logEvent(e: { outcome: string; detail: Record<string, unknown> }) {
    this.events.push(e);
  }
}

const ctx: SyncContext = {
  operatorId: IDS.operator,
  centreId: IDS.centre,
  centreCode: "C07",
  deviceId: DEVICE_ID,
  now: new Date("2026-11-02T10:00:00.000Z"),
  maxFutureSkewMinutes: 10,
};

let repo: MemoryRepo;
beforeEach(() => {
  repo = new MemoryRepo();
});

describe("processSyncBatch", () => {
  it("accepts a clean entry and stores it as approved", async () => {
    const entry = await makeEntry();
    const [result] = await processSyncBatch([entry], ctx, repo);

    expect(result).toMatchObject({ outcome: "accepted", slipNo: "C07-00001" });
    const stored = repo.entries.get(entry.clientId)!;
    expect(stored.approval_status).toBe("approved");
    expect(stored.flag_reasons).toEqual([]);
    expect(stored.net_kg).toBe("831.0");
    expect(stored.amount).toBe("40303.50");
  });

  it("treats a repeated sync of the same entry as a duplicate and stores one row", async () => {
    const entry = await makeEntry();
    await processSyncBatch([entry], ctx, repo);
    const [again] = await processSyncBatch([entry], ctx, repo);

    expect(again.outcome).toBe("duplicate");
    expect(repo.entries.size).toBe(1);
  });

  it("rejects a reused clientId carrying different data", async () => {
    const entry = await makeEntry();
    await processSyncBatch([entry], ctx, repo);
    const forged = await makeEntry({ clientId: entry.clientId, grossKg: "900.0", slipNo: "C07-00009" });

    const [result] = await processSyncBatch([forged], ctx, repo);
    expect(result).toMatchObject({ outcome: "rejected", reason: "client_id_reused_with_different_data" });
    expect(repo.entries.size).toBe(1);
  });

  it("rejects an entry whose contents were edited after hashing", async () => {
    const entry = await makeEntry();
    // Internally consistent figures for 900.0 kg gross, so only the hash gives it away.
    const tampered = { ...entry, grossKg: "900.0", netKg: "870.2", amount: "42204.70" };
    const [result] = await processSyncBatch([tampered], ctx, repo);

    expect(result).toMatchObject({ outcome: "rejected", reason: "hash_mismatch" });
    expect(repo.entries.size).toBe(0);
  });

  it("rejects an entry whose amount does not follow the rule", async () => {
    const bad = await makeEntry({ amount: "50000.00" });
    const [result] = await processSyncBatch([bad], ctx, repo);
    expect(result.outcome).toBe("rejected");
    expect(result.reason).toMatch(/^invalid_entry/);
  });

  it("rejects entries from another operator, centre or device", async () => {
    const otherOperator = await makeEntry({ operatorId: "44444444-4444-4444-8444-444444444444" });
    const otherCentre = await makeEntry({ slipNo: "C12-00001" });
    const otherDevice = await makeEntry({ deviceId: "dev-someone-elses-phone" });

    const results = await processSyncBatch([otherOperator, otherCentre, otherDevice], ctx, repo);
    expect(results.map((r) => r.reason)).toEqual([
      "entry_does_not_belong_to_this_operator",
      "entry_does_not_belong_to_this_operator",
      "entry_does_not_belong_to_this_operator",
    ]);
  });

  it("rejects an unknown farmer", async () => {
    repo.farmers.clear();
    const [result] = await processSyncBatch([await makeEntry()], ctx, repo);
    expect(result).toMatchObject({ outcome: "rejected", reason: "unknown_farmer" });
  });

  it("rejects a second entry that reuses a slip number", async () => {
    const first = await makeEntry();
    const second = await makeEntry({ slipNo: first.slipNo });
    const results = await processSyncBatch([first, second], ctx, repo);

    expect(results[0].outcome).toBe("accepted");
    expect(results[1]).toMatchObject({ outcome: "rejected", reason: "slip_number_already_used" });
  });

  it("holds payment, but keeps the purchase, when the rate differs from the price board", async () => {
    const entry = await makeEntry({ ratePerQuintal: "4900" });
    const [result] = await processSyncBatch([entry], ctx, repo);

    expect(result).toMatchObject({ outcome: "flagged", flagReasons: ["rate_mismatch"] });
    const stored = repo.entries.get(entry.clientId)!;
    expect(stored.approval_status).toBe("held");
    expect(stored.flag_reasons).toEqual(["rate_mismatch"]);
  });

  it("flags a day with no published price", async () => {
    repo.prices.clear();
    const [result] = await processSyncBatch([await makeEntry()], ctx, repo);
    expect(result).toMatchObject({ outcome: "flagged", flagReasons: ["no_price_for_day"] });
  });

  it("flags a device clock that is ahead of the server", async () => {
    const entry = await makeEntry({ deviceRecordedAt: "2026-11-02T11:00:00.000Z" });
    const [result] = await processSyncBatch([entry], ctx, repo);
    expect(result.outcome).toBe("flagged");
    expect(result.flagReasons).toContain("clock_ahead");
  });

  it("accepts an entry recorded hours earlier while the centre was offline", async () => {
    const entry = await makeEntry({ deviceRecordedAt: "2026-11-02T04:30:00.000Z" });
    const [result] = await processSyncBatch([entry], ctx, repo);
    expect(result.outcome).toBe("accepted");
  });

  it("follows a chain that spans entries sent in the same batch", async () => {
    const a = await makeEntry({ slipNo: "C07-00001" });
    const b = await makeEntry({ slipNo: "C07-00002", prevHash: a.payloadHash });
    const results = await processSyncBatch([a, b], ctx, repo);
    expect(results.map((r) => r.outcome)).toEqual(["accepted", "accepted"]);
  });

  it("flags a gap in the chain, for example a missing entry", async () => {
    const missing = await makeEntry({ slipNo: "C07-00001" });
    const next = await makeEntry({ slipNo: "C07-00002", prevHash: missing.payloadHash });
    const [result] = await processSyncBatch([next], ctx, repo);
    expect(result).toMatchObject({ outcome: "flagged", flagReasons: ["chain_gap"] });
  });

  it("does not let one bad entry block the rest of the batch", async () => {
    const bad = await makeEntry({ amount: "1.00" });
    const good = await makeEntry({ slipNo: "C07-00002" });
    const results = await processSyncBatch([bad, "garbage", good], ctx, repo);

    expect(results.map((r) => r.outcome)).toEqual(["rejected", "rejected", "accepted"]);
    expect(repo.entries.size).toBe(1);
  });

  it("logs every outcome", async () => {
    const good = await makeEntry();
    await processSyncBatch([good, good, { clientId: "x" }], ctx, repo);
    expect(repo.events.map((e) => e.outcome)).toEqual(["accepted", "duplicate", "rejected"]);
  });
});
