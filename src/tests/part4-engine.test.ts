import "fake-indexeddb/auto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import type { SupabaseClient } from "@supabase/supabase-js";
import { LocalDatabase } from "@/lib/db/local";
import { computePayloadHash } from "@/lib/offline/integrity";
import { getOrCreateDeviceId, recordProcurement, setSlipBlock } from "@/lib/offline/queue";
import { downloadReferenceData, getCachedRate, listCachedRates, type BootstrapPage } from "@/lib/offline/reference-data";
import { syncPending } from "@/lib/offline/sync";
import { processSyncBatch, type SyncContext } from "@/lib/services/sync-service";
import { IDS } from "./helpers";
import { MANAGER_PROFILE, OPERATOR_PROFILE, USER, fakeSupabase, type FakeSupabaseOptions } from "./fake-supabase";
import { MemoryRepo } from "./memory-repo";

const current = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => current.client as SupabaseClient }));

import { GET as listPrices, POST as saveDrafts } from "@/app/api/prices/route";
import { DELETE as deleteDraft, PATCH as editDraft } from "@/app/api/prices/[id]/route";
import { POST as publishPrices } from "@/app/api/prices/publish/route";
import { POST as sendSms } from "@/app/api/sms/send/route";
import { POST as refreshSms } from "@/app/api/sms/[id]/refresh/route";

beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
});

let counter = 0;
const newDb = () => new LocalDatabase(`kisansetu-p4-${++counter}`, { indexedDB, IDBKeyRange });

const page = (rate: string, version: number): BootstrapPage => ({
  members: [{ id: IDS.farmer, memberCode: "FM00101", fullName: "Sunil Jadhav", village: "Ganjur", phone: null, landAcres: 6, centreId: IDS.centre, crops: ["soybean"] }],
  prices: [{ priceDate: "2026-11-02", crop: "soybean", grade: "A", ratePerQuintal: rate, version, publishedAt: "2026-11-02T00:30:00.000Z" }],
  nextCursor: null,
  serverTime: "2026-11-02T01:00:00.000Z",
});
const serve = (p: BootstrapPage) => (async () => new Response(JSON.stringify(p), { status: 200 })) as unknown as typeof fetch;

const input = { farmerId: IDS.farmer, crop: "soybean" as const, grade: "A" as const, grossKg: "860.0", tareKg: "12.0", moisturePct: "14.0", ratePerQuintal: "4850.00" };

describe("rate snapshot on procurement entries", () => {
  let db: LocalDatabase;
  let deviceId: string;
  const context = () => ({ operatorId: IDS.operator, centreId: IDS.centre, centreCode: "C07", deviceId, now: new Date("2026-11-02T01:00:00.000Z") });

  beforeEach(async () => {
    db = newDb();
    deviceId = await getOrCreateDeviceId(db);
    await setSlipBlock(db, { centreCode: "C07", start: 24518, end: 24530 });
  });

  it("stores the rate, its effective date and its version with the entry", async () => {
    const entry = await recordProcurement(db, { ...input, rateDate: "2026-11-02", rateVersion: 1 }, context());
    expect(entry).toMatchObject({ ratePerQuintal: "4850.00", rateDate: "2026-11-02", rateVersion: 1 });
    expect(await db.entries.get(entry.seq!)).toMatchObject({ rateDate: "2026-11-02", rateVersion: 1 });
  });

  it("sends the snapshot to the server, which stores it with the entry", async () => {
    const entry = await recordProcurement(db, { ...input, rateDate: "2026-11-02", rateVersion: 1 }, context());
    const repo = new MemoryRepo();
    const ctx: SyncContext = { operatorId: IDS.operator, centreId: IDS.centre, centreCode: "C07", deviceId, now: new Date("2026-11-02T10:00:00.000Z"), maxFutureSkewMinutes: 10 };
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ results: await processSyncBatch(body.entries, ctx, repo), serverTime: ctx.now.toISOString() }), { status: 200 });
    }) as unknown as typeof fetch;

    await syncPending(db, { deviceId, fetchImpl });
    const stored = repo.entries.get(entry.clientId)!;
    expect(stored).toMatchObject({ rate_per_quintal: "4850.00", rate_price_date: "2026-11-02", rate_version: 1 });
  });

  it("works for entries recorded without a snapshot (older phones), and the hash does not depend on it", async () => {
    const plain = await recordProcurement(db, input, context());
    expect(plain.rateVersion).toBeNull();
    const { payloadHash: _h, ...unsigned } = plain;
    const withSnapshot = await computePayloadHash({ ...unsigned, rateDate: "2026-11-02", rateVersion: 9 });
    expect(withSnapshot).toBe(plain.payloadHash);
  });

  it("refuses an effective date that is not a date", async () => {
    await expect(recordProcurement(db, { ...input, rateDate: "yesterday-ish", rateVersion: 1 }, context())).rejects.toThrow();
  });

  it("does not silently apply a newly published price to an entry that already exists", async () => {
    await downloadReferenceData(db, { fetchImpl: serve(page("4850.00", 1)) });
    const entry = await recordProcurement(db, { ...input, rateDate: "2026-11-02", rateVersion: 1 }, context());

    // While the phone is offline the board publishes a correction; the phone later downloads it.
    await downloadReferenceData(db, { fetchImpl: serve(page("4900.00", 2)) });

    expect(await getCachedRate(db, "2026-11-02", "soybean", "A")).toBe("4900.00");
    const kept = await db.entries.get(entry.seq!);
    expect(kept).toMatchObject({ ratePerQuintal: "4850.00", rateVersion: 1, amount: "40303.50", netKg: "831.0" });
  });

  it("keeps the older rate on an entry synced after the correction, which the server then holds for review", async () => {
    const entry = await recordProcurement(db, { ...input, rateDate: "2026-11-02", rateVersion: 1 }, context());
    const repo = new MemoryRepo();
    repo.prices.set("2026-11-02|soybean|A", "4900.00"); // the corrected rate is now live
    const ctx: SyncContext = { operatorId: IDS.operator, centreId: IDS.centre, centreCode: "C07", deviceId, now: new Date("2026-11-02T10:00:00.000Z"), maxFutureSkewMinutes: 10 };
    const [result] = await processSyncBatch([await db.entries.get(entry.seq!)], ctx, repo);

    expect(result.outcome).toBe("flagged");
    expect(repo.entries.get(entry.clientId)!.rate_per_quintal).toBe("4850.00");
    expect(repo.entries.get(entry.clientId)!.approval_status).toBe("held");
  });

  it("gives every centre the same rate for the same crop, grade and date", async () => {
    const centreA = newDb();
    const centreB = newDb();
    await downloadReferenceData(centreA, { fetchImpl: serve(page("4850.00", 1)) });
    await downloadReferenceData(centreB, { fetchImpl: serve(page("4850.00", 1)) });
    expect(await listCachedRates(centreA, "2026-11-02")).toEqual(await listCachedRates(centreB, "2026-11-02"));
  });

  it("keeps the version and publication time of cached prices for display", async () => {
    await downloadReferenceData(db, { fetchImpl: serve(page("4850.00", 3)) });
    const [row] = await listCachedRates(db, "2026-11-02");
    expect(row).toMatchObject({ version: 3, publishedAt: "2026-11-02T00:30:00.000Z" });
  });
});

describe("price and SMS routes: who may call them", () => {
  const MANAGER = { options: { user: USER, tables: { profiles: MANAGER_PROFILE } } as FakeSupabaseOptions };
  const OPERATOR = { options: { user: USER, tables: { profiles: OPERATOR_PROFILE } } as FakeSupabaseOptions };
  const ANON = { options: { user: null } as FakeSupabaseOptions };
  const use = (who: { options: FakeSupabaseOptions }, extra: Partial<FakeSupabaseOptions> = {}) => {
    const fake = fakeSupabase({ ...who.options, ...extra });
    current.client = fake.client;
    return fake;
  };
  const post = (url: string, body: unknown) =>
    new Request(`http://localhost${url}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const ID = "55555555-5555-4555-8555-555555555555";
  const ctx = { params: Promise.resolve({ id: ID }) };
  const futureDate = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const board = (over: Record<string, unknown> = {}) => ({ date: futureDate(), rows: [{ crop: "soybean", grade: "A", rate: "4850" }], ...over });

  it("lets only an office manager see history, save, edit, delete or publish prices", async () => {
    for (const who of [OPERATOR, ANON]) {
      const status = who === ANON ? 401 : 403;
      const fake = use(who);
      expect((await listPrices(new Request("http://localhost/api/prices"))).status).toBe(status);
      expect((await saveDrafts(post("/api/prices", board()))).status).toBe(status);
      expect((await editDraft(post("/api/prices/x", { rate: "1" }), ctx)).status).toBe(status);
      expect((await deleteDraft(post("/api/prices/x", {}), ctx)).status).toBe(status);
      expect((await publishPrices(post("/api/prices/publish", { ids: [ID], confirm: true }))).status).toBe(status);
      expect(fake.rpcCalls).toEqual([]); // nothing reached the database
    }
  });

  it("saves a board for a manager through the database function", async () => {
    const fake = use(MANAGER, { rpc: () => ({ data: { created: 1, updated: 0, unchanged: 0 } }) });
    const response = await saveDrafts(post("/api/prices", board()));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ created: 1 });
    expect(fake.rpcCalls[0]).toMatchObject({ name: "save_price_drafts", args: { p_rows: [{ crop: "soybean", grade: "A", rate: "4850" }] } });
  });

  it("refuses a past or too-distant effective date before calling the database", async () => {
    const fake = use(MANAGER);
    const past = await saveDrafts(post("/api/prices", board({ date: "2020-01-01" })));
    expect(past.status).toBe(422);
    expect((await past.json()).fieldErrors.date).toMatch(/past/i);
    const far = await saveDrafts(post("/api/prices", board({ date: "2099-01-01" })));
    expect((await far.json()).fieldErrors.date).toMatch(/far/i);
    expect(fake.rpcCalls).toEqual([]);
  });

  it("refuses bad rates, extra keys and an attempt to publish by saving", async () => {
    const fake = use(MANAGER);
    expect((await saveDrafts(post("/api/prices", board({ rows: [{ crop: "soybean", grade: "A", rate: "-5" }] })))).status).toBe(422);
    expect((await saveDrafts(post("/api/prices", board({ status: "published" })))).status).toBe(422);
    expect((await saveDrafts(post("/api/prices", board({ rows: [{ crop: "soybean", grade: "A", rate: "1", publishedBy: "me" }] })))).status).toBe(422);
    expect(fake.rpcCalls).toEqual([]);
  });

  it("asks for a reason when the database says a correction needs one", async () => {
    use(MANAGER, { rpc: () => ({ error: { code: "22023", message: "a correction needs a reason of at least 5 characters" } }) });
    const response = await saveDrafts(post("/api/prices", board()));
    expect(response.status).toBe(422);
    expect((await response.json()).fieldErrors.reason).toBeTruthy();
  });

  it("will not publish without explicit confirmation", async () => {
    const fake = use(MANAGER);
    expect((await publishPrices(post("/api/prices/publish", { ids: [ID] }))).status).toBe(422);
    expect((await publishPrices(post("/api/prices/publish", { ids: [ID], confirm: false }))).status).toBe(422);
    expect(fake.rpcCalls).toEqual([]);
    const fakeOk = use(MANAGER, { rpc: () => ({ data: 1 }) });
    const ok = await publishPrices(post("/api/prices/publish", { ids: [ID], confirm: true }));
    expect(await ok.json()).toEqual({ published: 1 });
    expect(fakeOk.rpcCalls[0]).toMatchObject({ name: "publish_prices", args: { p_ids: [ID] } });
  });

  it("reports an edit of a published price as invalid, and never as a success", async () => {
    use(MANAGER, { rpc: () => ({ error: { code: "23514", message: "only an unpublished price can be edited" } }) });
    const edit = await editDraft(post("/api/prices/x", { rate: "5000" }), ctx);
    expect(edit.status).toBe(422);
    const del = await deleteDraft(post("/api/prices/x", {}), ctx);
    expect(del.status).toBe(422);
  });

  it("does not leak database wording to the browser", async () => {
    use(MANAGER, { rpc: () => ({ error: { code: "23514", message: "price_versions_guard: secret detail" } }) });
    const response = await publishPrices(post("/api/prices/publish", { ids: [ID], confirm: true }));
    expect(JSON.stringify(await response.json())).not.toMatch(/price_versions|secret/);
  });

  it("lets only a centre operator send slip SMS, and refuses managers and strangers", async () => {
    const body = { entryClientId: ID, language: "mr" };
    for (const [who, status] of [[MANAGER, 403], [ANON, 401]] as const) {
      const fake = use(who);
      expect((await sendSms(post("/api/sms/send", body))).status).toBe(status);
      expect((await refreshSms(post(`/api/sms/${ID}/refresh`, {}), ctx)).status).toBe(status);
      expect(fake.queriedTables.filter((t) => t !== "profiles")).toEqual([]);
    }
  });

  it("validates the send request, and ignores a client-supplied message body", async () => {
    const fake = use(OPERATOR);
    expect((await sendSms(post("/api/sms/send", { entryClientId: "nope" }))).status).toBe(422);
    expect((await sendSms(post("/api/sms/send", { entryClientId: ID, language: "fr" }))).status).toBe(422);
    // A "body" or phone number from the browser is not accepted at all.
    expect((await sendSms(post("/api/sms/send", { entryClientId: ID, body: "pay me", to: "9999999999" }))).status).toBe(422);
    expect(fake.queriedTables.filter((t) => t !== "profiles")).toEqual([]);
  });

  it("answers 404 when the entry has not reached the server, so the phone keeps the request queued", async () => {
    use(OPERATOR);
    const response = await sendSms(post("/api/sms/send", { entryClientId: ID, language: "mr" }));
    expect(response.status).toBe(404);
  });
});
