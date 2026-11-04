import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { LocalDatabase } from "@/lib/db/local";
import { getOrCreateDeviceId, recordProcurement, setSlipBlock } from "@/lib/offline/queue";
import { processSmsQueue, queueSlipSms, refreshSentSms, retrySlipSms } from "@/lib/offline/sms-queue";
import { syncPending } from "@/lib/offline/sync";
import {
  refreshSmsStatus,
  sendSlipSms,
  toPublicSms,
  type NewSms,
  type SmsDeps,
  type SmsPatch,
  type SmsRecord,
  type SmsRepository,
  type SmsSource,
} from "@/lib/services/sms-service";
import { processSyncBatch, type SyncContext } from "@/lib/services/sync-service";
import { smsLength } from "@/lib/sms/message";
import { maskPhone, normalizeIndianMobile } from "@/lib/sms/phone";
import { MOCK_RECEIPT_DELAY_MS, SmsSendError, createMockSmsProvider, type SmsProvider } from "@/lib/sms/provider";
import type { SlipInput } from "@/lib/slip/slip";
import { IDS } from "./helpers";
import { MemoryRepo } from "./memory-repo";

const SLIP: SlipInput = {
  slipNo: "C07-24518", farmerName: "Sunil Jadhav", farmerCode: "FM00101", village: "Ganjur",
  centreName: "Ganjur Collection Centre", centreCode: "C07", crop: "soybean", grade: "A",
  grossKg: "1250.0", tareKg: "18.0", moisturePct: "11.5", ratePerQuintal: "4850.00", netKg: "1232.0",
  amount: "59752.00", recordedAt: "2026-11-02T00:40:00.000Z", paymentStatus: "unpaid",
};

class MemorySmsRepo implements SmsRepository {
  rows = new Map<string, SmsRecord & { farmerId: string; centreId: string }>();
  sources = new Map<string, SmsSource>();
  private n = 0;

  addEntry(clientId: string, phone: string | null, entryId = `entry-${clientId.slice(0, 4)}`) {
    this.sources.set(clientId, { entryId, farmerId: IDS.farmer, centreId: IDS.centre, phone, slip: SLIP });
    return entryId;
  }
  async loadSource(clientId: string) {
    return this.sources.get(clientId) ?? null;
  }
  async findByEntryId(entryId: string) {
    return [...this.rows.values()].find((r) => r.entryId === entryId) ?? null;
  }
  async getById(id: string) {
    return this.rows.get(id) ?? null;
  }
  async create(row: NewSms) {
    if (await this.findByEntryId(row.entryId)) return null;
    const record = {
      id: `sms-${++this.n}`, entryId: row.entryId, status: "sending" as const, language: row.language,
      recipientMasked: row.recipientMasked, body: row.body, failureReason: null, providerRef: null, attempts: 0,
      createdAt: row.createdAt, sentAt: null, statusAt: row.createdAt, farmerId: row.farmerId, centreId: row.centreId,
    };
    this.rows.set(record.id, record);
    return record;
  }
  async update(id: string, patch: SmsPatch) {
    const row = this.rows.get(id)!;
    Object.assign(row, {
      status: patch.status, statusAt: patch.statusAt,
      ...(patch.failureReason !== undefined ? { failureReason: patch.failureReason } : {}),
      ...(patch.providerRef !== undefined ? { providerRef: patch.providerRef } : {}),
      ...(patch.attempts !== undefined ? { attempts: patch.attempts } : {}),
      ...(patch.sentAt !== undefined ? { sentAt: patch.sentAt } : {}),
    });
    return row;
  }
}

const CLIENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FARMER_PHONE = "9876543210";

describe("phone numbers", () => {
  it("masks all but the first two and last four digits", () => {
    expect(maskPhone("9876543210")).toBe("+91 98****3210");
    expect(maskPhone("+91 98765 43210")).toBe("+91 98****3210");
  });

  it("never lets a full number into the masked form", () => {
    expect(maskPhone("9876543210")).not.toMatch(/\d{7}/);
    expect(maskPhone("not a number")).toBe("****");
  });

  it("accepts the usual ways of writing an Indian mobile number", () => {
    for (const raw of ["9876543210", "+919876543210", "919876543210", "09876543210", "98765 43210", "98765-43210"]) {
      expect(normalizeIndianMobile(raw)).toBe("9876543210");
    }
    for (const bad of ["", null, undefined, "12345", "5876543210", "98765432101"]) {
      expect(normalizeIndianMobile(bad as never)).toBeNull();
    }
  });
});

describe("SMS length", () => {
  it("counts a Marathi message as UCS-2, which fits 70 characters in one part", () => {
    expect(smsLength("रक्कम")).toEqual({ encoding: "UCS-2", characters: 5, segments: 1 });
    expect(smsLength("र".repeat(70)).segments).toBe(1);
    expect(smsLength("र".repeat(71)).segments).toBe(2);
    expect(smsLength("र".repeat(135)).segments).toBe(3);
  });

  it("counts plain English as GSM-7 with 160 characters in one part", () => {
    expect(smsLength("Amount 100")).toMatchObject({ encoding: "GSM-7", segments: 1 });
    expect(smsLength("a".repeat(161)).segments).toBe(2);
    expect(smsLength("")).toMatchObject({ segments: 0 });
  });

  it("treats the rupee sign as forcing UCS-2", () => {
    expect(smsLength("₹100").encoding).toBe("UCS-2");
  });
});

describe("mock SMS gateway", () => {
  const provider = createMockSmsProvider();

  it("accepts a message but does not claim delivery until a receipt exists", async () => {
    const accepted = await provider.send({ to: FARMER_PHONE, body: "hello" });
    const soon = new Date(Date.parse(accepted.acceptedAt) + MOCK_RECEIPT_DELAY_MS - 1);
    expect(provider.getDeliveryReceipt(accepted.providerRef, accepted.acceptedAt, soon)).toEqual({ status: "pending" });
    const later = new Date(Date.parse(accepted.acceptedAt) + MOCK_RECEIPT_DELAY_MS);
    expect(provider.getDeliveryReceipt(accepted.providerRef, accepted.acceptedAt, later).status).toBe("delivered");
  });

  it("simulates a failed delivery on request", async () => {
    const accepted = await provider.send({ to: FARMER_PHONE, body: "hello", simulateFailure: true });
    const later = new Date(Date.parse(accepted.acceptedAt) + MOCK_RECEIPT_DELAY_MS + 1);
    expect(provider.getDeliveryReceipt(accepted.providerRef, accepted.acceptedAt, later)).toMatchObject({
      status: "failed",
      reason: "simulated_failure",
    });
  });

  it("fails delivery to a number ending 0000, a fixed unreachable phone for testing", async () => {
    const accepted = await provider.send({ to: "9876540000", body: "hello" });
    const later = new Date(Date.parse(accepted.acceptedAt) + MOCK_RECEIPT_DELAY_MS + 1);
    expect(provider.getDeliveryReceipt(accepted.providerRef, accepted.acceptedAt, later)).toMatchObject({ status: "failed", reason: "number_unreachable" });
  });

  it("refuses a number that is not a mobile and an empty message, as a gateway would", async () => {
    await expect(provider.send({ to: "12345", body: "x" })).rejects.toBeInstanceOf(SmsSendError);
    await expect(provider.send({ to: FARMER_PHONE, body: "  " })).rejects.toBeInstanceOf(SmsSendError);
  });

  it("never reports an unrecognised reference as delivered", () => {
    const receipt = provider.getDeliveryReceipt("something-else", "2026-11-02T00:00:00.000Z", new Date("2026-11-02T01:00:00.000Z"));
    expect(receipt.status).toBe("failed");
  });

  it("works out the same receipt on any server instance, with no shared state", async () => {
    const accepted = await provider.send({ to: FARMER_PHONE, body: "hello" });
    const other = createMockSmsProvider();
    const later = new Date(Date.parse(accepted.acceptedAt) + 5000);
    expect(other.getDeliveryReceipt(accepted.providerRef, accepted.acceptedAt, later).status).toBe("delivered");
  });
});

describe("SMS service", () => {
  let repo: MemorySmsRepo;
  let clock: Date;
  let provider: SmsProvider;
  let sendSpy: ReturnType<typeof vi.fn>;
  const deps = (): SmsDeps => ({ repo, provider, now: () => clock });
  const advance = (ms: number) => { clock = new Date(clock.getTime() + ms); };

  beforeEach(() => {
    repo = new MemorySmsRepo();
    clock = new Date("2026-11-02T06:00:00.000Z");
    const real = createMockSmsProvider();
    sendSpy = vi.fn(async (req: Parameters<SmsProvider["send"]>[0]) => {
      const accepted = await real.send(req);
      return { ...accepted, acceptedAt: clock.toISOString() };
    });
    provider = { name: "mock", send: sendSpy as SmsProvider["send"], getDeliveryReceipt: real.getDeliveryReceipt };
    repo.addEntry(CLIENT, FARMER_PHONE);
  });

  it("generates the Marathi message, records it and the masked number, and reports 'sent', not 'delivered'", async () => {
    const result = await sendSlipSms(deps(), { entryClientId: CLIENT, language: "mr", operatorId: IDS.operator });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.record.status).toBe("sent");
    expect(result.record.body).toContain("रक्कम ₹59,752.00");
    expect(result.record.body).toContain("C07-24518");
    expect(result.record.recipientMasked).toBe("+91 98****3210");
    expect(result.record.attempts).toBe(1);
    expect(result.record.sentAt).toBe("2026-11-02T06:00:00.000Z");
    expect(result.record.statusAt).toBeTruthy();
    // The full number is not kept anywhere in the log.
    expect(JSON.stringify([...repo.rows.values()])).not.toContain(FARMER_PHONE);
  });

  it("stays 'sent' while the gateway has no receipt, then becomes 'delivered' only on one", async () => {
    const sent = await sendSlipSms(deps(), { entryClientId: CLIENT, language: "mr", operatorId: IDS.operator });
    if (!sent.ok) throw new Error("expected ok");

    advance(MOCK_RECEIPT_DELAY_MS - 1);
    expect((await refreshSmsStatus(deps(), sent.record.id))!.status).toBe("sent");

    advance(2);
    const done = (await refreshSmsStatus(deps(), sent.record.id))!;
    expect(done.status).toBe("delivered");
    expect(done.failureReason).toBeNull();
    expect(done.statusAt).toBeTruthy();
  });

  it("records a simulated delivery failure with its reason", async () => {
    const sent = await sendSlipSms(deps(), { entryClientId: CLIENT, language: "mr", operatorId: IDS.operator, simulateFailure: true });
    if (!sent.ok) throw new Error("expected ok");
    expect(sent.record.status).toBe("sent"); // accepted by the gateway; not yet known to have failed
    advance(MOCK_RECEIPT_DELAY_MS + 1);
    const failed = (await refreshSmsStatus(deps(), sent.record.id))!;
    expect(failed).toMatchObject({ status: "failed", failureReason: "simulated_failure" });
  });

  it("records a gateway refusal as a failure, not as a success", async () => {
    provider = { ...provider, send: async () => { throw new SmsSendError("gateway_down"); } };
    const result = await sendSlipSms(deps(), { entryClientId: CLIENT, language: "mr", operatorId: IDS.operator });
    expect(result.ok && result.record).toMatchObject({ status: "failed", failureReason: "gateway_down" });
  });

  it("sends one message per entry: asking again returns the first and does not call the gateway again", async () => {
    await sendSlipSms(deps(), { entryClientId: CLIENT, language: "mr", operatorId: IDS.operator });
    const again = await sendSlipSms(deps(), { entryClientId: CLIENT, language: "mr", operatorId: IDS.operator });
    expect(again.ok && again.reused).toBe(true);
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(repo.rows.size).toBe(1);
  });

  it("allows a retry after a failure and counts the attempt", async () => {
    const first = await sendSlipSms(deps(), { entryClientId: CLIENT, language: "mr", operatorId: IDS.operator, simulateFailure: true });
    if (!first.ok) throw new Error("expected ok");
    advance(MOCK_RECEIPT_DELAY_MS + 1);
    await refreshSmsStatus(deps(), first.record.id);

    const retry = await sendSlipSms(deps(), { entryClientId: CLIENT, language: "mr", operatorId: IDS.operator });
    expect(retry.ok && retry.record).toMatchObject({ status: "sent", attempts: 2, failureReason: null });
    advance(MOCK_RECEIPT_DELAY_MS + 1);
    expect((await refreshSmsStatus(deps(), first.record.id))!.status).toBe("delivered");
    expect(repo.rows.size).toBe(1);
  });

  it("never re-sends a delivered message", async () => {
    const first = await sendSlipSms(deps(), { entryClientId: CLIENT, language: "mr", operatorId: IDS.operator });
    if (!first.ok) throw new Error("expected ok");
    advance(5000);
    await refreshSmsStatus(deps(), first.record.id);
    const again = await sendSlipSms(deps(), { entryClientId: CLIENT, language: "mr", operatorId: IDS.operator, simulateFailure: true });
    expect(again.ok && again.record.status).toBe("delivered");
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });

  it("explains why when it cannot send, and records nothing", async () => {
    repo.addEntry("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", null);
    repo.addEntry("cccccccc-cccc-4ccc-8ccc-cccccccccccc", "12345");
    expect(await sendSlipSms(deps(), { entryClientId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", language: "mr", operatorId: IDS.operator })).toEqual({ ok: false, reason: "no_phone" });
    expect(await sendSlipSms(deps(), { entryClientId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", language: "mr", operatorId: IDS.operator })).toEqual({ ok: false, reason: "invalid_phone" });
    expect(await sendSlipSms(deps(), { entryClientId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", language: "mr", operatorId: IDS.operator })).toEqual({ ok: false, reason: "entry_not_found" });
    expect(repo.rows.size).toBe(0);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("builds the message from the stored entry in the language asked for", async () => {
    const en = await sendSlipSms(deps(), { entryClientId: CLIENT, language: "en", operatorId: IDS.operator });
    expect(en.ok && en.record.body).toContain("Amount ₹59,752.00");
    expect(en.ok && en.record.language).toBe("en");
  });

  it("does not expose the gateway reference to browsers", async () => {
    const sent = await sendSlipSms(deps(), { entryClientId: CLIENT, language: "mr", operatorId: IDS.operator });
    if (!sent.ok) throw new Error("expected ok");
    expect(sent.record.providerRef).toMatch(/^mock:/);
    expect(toPublicSms(sent.record)).not.toHaveProperty("providerRef");
  });
});

// ---------------------------------------------------------------------------------------------
// The phone's SMS queue, run against the real SMS service and the real entry sync.

let counter = 0;
const newDb = () => new LocalDatabase(`kisansetu-sms-${++counter}`, { indexedDB, IDBKeyRange });

describe("SMS queue on the phone", () => {
  let db: LocalDatabase;
  let smsRepo: MemorySmsRepo;
  let entryRepo: MemoryRepo;
  let clock: Date;
  let deviceId: string;
  let online: boolean;
  const fetchCalls: string[] = [];

  /** One fetch that routes to the real services, and fails like a dead network when offline. */
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    if (!online) throw new TypeError("offline");
    fetchCalls.push(url);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const real = createMockSmsProvider();
    // The gateway stamps acceptance with the test's clock, so receipts fall due in simulated time.
    const provider: SmsProvider = {
      name: "mock",
      send: async (req) => ({ ...(await real.send(req)), acceptedAt: clock.toISOString() }),
      getDeliveryReceipt: real.getDeliveryReceipt,
    };
    const smsDeps: SmsDeps = { repo: smsRepo, provider, now: () => clock };

    if (url === "/api/sync") {
      const ctx: SyncContext = { operatorId: IDS.operator, centreId: IDS.centre, centreCode: "C07", deviceId, now: clock, maxFutureSkewMinutes: 10 };
      const results = await processSyncBatch(body.entries, ctx, entryRepo);
      // Once an entry reaches the server its SMS source exists too.
      for (const e of body.entries) smsRepo.addEntry(e.clientId, FARMER_PHONE);
      return new Response(JSON.stringify({ results, serverTime: clock.toISOString() }), { status: 200 });
    }
    if (url === "/api/sms/send") {
      const result = await sendSlipSms(smsDeps, { entryClientId: body.entryClientId, language: body.language, operatorId: IDS.operator, simulateFailure: body.simulateFailure });
      if (!result.ok) return new Response(JSON.stringify({ reason: result.reason }), { status: result.reason === "entry_not_found" ? 404 : 422 });
      return new Response(JSON.stringify({ sms: toPublicSms(result.record) }), { status: 200 });
    }
    const refresh = url.match(/^\/api\/sms\/(.+)\/refresh$/);
    if (refresh) {
      const record = await refreshSmsStatus(smsDeps, refresh[1]);
      return new Response(JSON.stringify({ sms: toPublicSms(record!) }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;

  const input = { farmerId: IDS.farmer, crop: "soybean" as const, grade: "A" as const, grossKg: "1250.0", tareKg: "18.0", moisturePct: "11.5", ratePerQuintal: "4850" };
  const sync = () => syncPending(db, { deviceId, operatorId: IDS.operator, fetchImpl });
  const smsPass = () => processSmsQueue(db, { operatorId: IDS.operator, fetchImpl });
  const advance = (ms: number) => { clock = new Date(clock.getTime() + ms); };

  async function record() {
    return recordProcurement(db, input, {
      operatorId: IDS.operator, centreId: IDS.centre, centreCode: "C07", deviceId, now: new Date("2026-11-02T00:40:00.000Z"),
    });
  }
  const note = async (id: string) => (await db.notifications.get(id))!;

  beforeEach(async () => {
    db = newDb();
    smsRepo = new MemorySmsRepo();
    entryRepo = new MemoryRepo();
    clock = new Date("2026-11-02T10:00:00.000Z");
    online = true;
    fetchCalls.length = 0;
    deviceId = await getOrCreateDeviceId(db);
    await setSlipBlock(db, { centreCode: "C07", start: 24518, end: 24530 });
  });

  it("queues one request per entry, however many times it is asked", async () => {
    const entry = await record();
    const a = await queueSlipSms(db, { entryClientId: entry.clientId, operatorId: IDS.operator, farmerId: IDS.farmer });
    const b = await queueSlipSms(db, { entryClientId: entry.clientId, operatorId: IDS.operator, farmerId: IDS.farmer, language: "en" });
    expect(b.queuedAt).toBe(a.queuedAt);
    expect(b.language).toBe("mr");
    expect(await db.notifications.count()).toBe(1);
  });

  it("while offline: the request waits on the phone and nothing is sent", async () => {
    online = false;
    const entry = await record();
    await queueSlipSms(db, { entryClientId: entry.clientId, operatorId: IDS.operator, farmerId: IDS.farmer });
    const summary = await smsPass();

    expect(summary.waiting).toBe(1);
    expect(fetchCalls).toEqual([]);
    expect((await note(entry.clientId)).status).toBe("queued");
  });

  it("waits for the entry to be confirmed by the server, even when online", async () => {
    const entry = await record();
    await queueSlipSms(db, { entryClientId: entry.clientId, operatorId: IDS.operator, farmerId: IDS.farmer });
    const summary = await smsPass();

    expect(summary.waiting).toBe(1);
    expect(fetchCalls).toEqual([]);
    expect((await note(entry.clientId)).status).toBe("queued");
  });

  it("goes out after the entry syncs, and is 'sent', not 'delivered', until a receipt says so", async () => {
    online = false;
    const entry = await record();
    await queueSlipSms(db, { entryClientId: entry.clientId, operatorId: IDS.operator, farmerId: IDS.farmer });
    await smsPass();

    online = true;
    await sync();
    const sent = await smsPass();
    expect(sent.sent).toBe(1);
    const row = await note(entry.clientId);
    expect(row.status).toBe("sent");
    expect(row.recipientMasked).toBe("+91 98****3210");

    // No receipt yet: a refresh keeps it "sent".
    await refreshSentSms(db, { operatorId: IDS.operator, fetchImpl });
    expect((await note(entry.clientId)).status).toBe("sent");

    advance(MOCK_RECEIPT_DELAY_MS + 1);
    const done = await refreshSentSms(db, { operatorId: IDS.operator, fetchImpl });
    expect(done.delivered).toBe(1);
    expect((await note(entry.clientId)).status).toBe("delivered");
    expect(smsRepo.rows.size).toBe(1);
  });

  it("keeps the request queued when the connection drops while sending, and sends once on retry", async () => {
    const entry = await record();
    await sync();
    await queueSlipSms(db, { entryClientId: entry.clientId, operatorId: IDS.operator, farmerId: IDS.farmer });

    online = false;
    const dropped = await smsPass();
    expect(dropped.stoppedBecause).toBe("offline");
    const waiting = await note(entry.clientId);
    expect(waiting).toMatchObject({ status: "queued", attempts: 1, lastError: "no_connection" });

    online = true;
    await smsPass();
    await smsPass();
    expect(smsRepo.rows.size).toBe(1);
    expect((await note(entry.clientId)).status).toBe("sent");
  });

  it("shows a simulated delivery failure, and can be retried", async () => {
    const entry = await record();
    await sync();
    await queueSlipSms(db, { entryClientId: entry.clientId, operatorId: IDS.operator, farmerId: IDS.farmer, simulateFailure: true });
    await smsPass();
    advance(MOCK_RECEIPT_DELAY_MS + 1);
    const failed = await refreshSentSms(db, { operatorId: IDS.operator, fetchImpl });

    expect(failed.failed).toBe(1);
    expect(await note(entry.clientId)).toMatchObject({ status: "failed", failureReason: "simulated_failure" });

    expect(await retrySlipSms(db, entry.clientId)).toBe(true);
    expect((await note(entry.clientId)).status).toBe("queued");
    await smsPass();
    advance(MOCK_RECEIPT_DELAY_MS + 1);
    await refreshSentSms(db, { operatorId: IDS.operator, fetchImpl });
    expect((await note(entry.clientId)).status).toBe("delivered");
    expect(smsRepo.rows.size).toBe(1);
  });

  it("does not let a delivered message be queued again", async () => {
    const entry = await record();
    await sync();
    await queueSlipSms(db, { entryClientId: entry.clientId, operatorId: IDS.operator, farmerId: IDS.farmer });
    await smsPass();
    advance(MOCK_RECEIPT_DELAY_MS + 1);
    await refreshSentSms(db, { operatorId: IDS.operator, fetchImpl });
    expect(await retrySlipSms(db, entry.clientId)).toBe(false);
  });

  it("marks the request unavailable when the farmer has no usable phone", async () => {
    const entry = await record();
    await sync();
    smsRepo.addEntry(entry.clientId, null);
    await queueSlipSms(db, { entryClientId: entry.clientId, operatorId: IDS.operator, farmerId: IDS.farmer });
    await smsPass();
    expect(await note(entry.clientId)).toMatchObject({ status: "unavailable", failureReason: "no_phone" });
  });

  it("never sends another operator's queued messages", async () => {
    const entry = await record();
    await sync();
    await queueSlipSms(db, { entryClientId: entry.clientId, operatorId: "99999999-9999-4999-8999-999999999999", farmerId: IDS.farmer });
    await smsPass();
    expect(fetchCalls.filter((u) => u.includes("/sms"))).toEqual([]);
  });

  it("keeps queued messages across closing and reopening the app", async () => {
    online = false;
    const entry = await record();
    await queueSlipSms(db, { entryClientId: entry.clientId, operatorId: IDS.operator, farmerId: IDS.farmer });
    const name = db.name;
    db.close();
    const reopened = new LocalDatabase(name, { indexedDB, IDBKeyRange });
    expect((await reopened.notifications.get(entry.clientId))!.status).toBe("queued");
  });
});
