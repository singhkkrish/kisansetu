import "fake-indexeddb/auto";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MANAGER_PROFILE, OPERATOR_PROFILE, USER, fakeSupabase, type FakeSupabaseOptions } from "./fake-supabase";

const current = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => current.client as SupabaseClient }));

import { POST as reviewAnomaly } from "@/app/api/anomalies/[id]/review/route";
import { POST as saveSetting } from "@/app/api/anomaly-settings/route";
import { POST as reviewEntry } from "@/app/api/procurement/[id]/review/route";
import { describeAnomaly } from "@/lib/anomalies/describe";
import { resolveField, type FieldState } from "@/lib/ai/reading-flow";
import { LocalDatabase } from "@/lib/db/local";
import { getPart6Messages } from "@/lib/i18n/part6-messages";
import { computePayloadHash } from "@/lib/offline/integrity";
import { getOrCreateDeviceId, recordProcurement, setSlipBlock } from "@/lib/offline/queue";
import { previewPayment } from "@/lib/services/payments";
import { processSyncBatch, type SyncContext } from "@/lib/services/sync-service";
import { entryRecordSchema } from "@/lib/validation/procurement";
import { DEVICE_ID, IDS, makeEntry } from "./helpers";
import { MemoryRepo } from "./memory-repo";

beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
});
beforeEach(() => {
  current.client = null;
});

function withClient(options: FakeSupabaseOptions) {
  const fake = fakeSupabase(options);
  current.client = fake.client;
  return fake;
}
const post = (body?: unknown) =>
  new Request("http://localhost/api/x", { method: "POST", headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const FLAG = "77777777-7777-4777-8777-777777777777";
const ctx = (id = FLAG) => ({ params: Promise.resolve({ id }) });

// ---------------------------------------------------------------------------
describe("the operator's decision about an AI suggestion", () => {
  const base: FieldState = { suggestion: { value: "860.0", confidence: "high" }, attemptedWithoutValue: false, decision: "undecided", value: "", acknowledged: false };

  it("cannot go on until the operator decides, and nothing is recorded as confirmed", () => {
    expect(resolveField(base)).toEqual({ meta: undefined, blocked: "decide" });
    expect(resolveField({ ...base, value: "860.0" })).toEqual({ meta: undefined, blocked: "decide" });
  });

  it("records a confirmed reading when the operator accepts it unchanged", () => {
    expect(resolveField({ ...base, decision: "accepted", value: "860.0" })).toEqual({
      meta: { source: "ai_confirmed", aiValue: "860.0", aiConfidence: "high" },
      blocked: null,
    });
    // "860" is the same number as "860.0".
    expect(resolveField({ ...base, decision: "corrected", value: "860" }).meta?.source).toBe("ai_confirmed");
  });

  it("requires an explicit confirmation when the operator's value differs", () => {
    expect(resolveField({ ...base, decision: "corrected", value: "850.0" })).toEqual({ meta: undefined, blocked: "acknowledge" });
    expect(resolveField({ ...base, decision: "accepted", value: "861.0" }).blocked).toBe("acknowledge");
    expect(resolveField({ ...base, decision: "corrected", value: "850.0", acknowledged: true })).toEqual({
      meta: { source: "ai_corrected", aiValue: "860.0", aiConfidence: "high" },
      blocked: null,
    });
  });

  it("needs a value once the operator chooses to correct", () => {
    expect(resolveField({ ...base, decision: "corrected", value: "" })).toEqual({ meta: undefined, blocked: "value" });
  });

  it("lets the operator reject the reading and type by hand", () => {
    expect(resolveField({ ...base, decision: "rejected", value: "850.0" })).toEqual({
      meta: { source: "manual", aiValue: "860.0", aiConfidence: "high" },
      blocked: null,
    });
  });

  it("keeps a medium confidence on the record", () => {
    const out = resolveField({ ...base, suggestion: { value: "11.4", confidence: "medium" }, decision: "accepted", value: "11.4" });
    expect(out.meta).toEqual({ source: "ai_confirmed", aiValue: "11.4", aiConfidence: "medium" });
  });

  it("with no usable suggestion (uncertain or failed) nothing is prefilled or blocked; the figure is manual", () => {
    expect(resolveField({ ...base, suggestion: null, attemptedWithoutValue: true, value: "850.0" })).toEqual({ meta: { source: "manual" }, blocked: null });
    expect(resolveField({ ...base, suggestion: null, attemptedWithoutValue: false, value: "850.0" })).toEqual({ meta: undefined, blocked: null });
  });
});

// ---------------------------------------------------------------------------
describe("explaining an anomaly", () => {
  const cases: [string, Record<string, unknown>, RegExp][] = [
    ["weight_vs_land", { total_kg: 2200, this_kg: 700, land_acres: 2, max_kg_per_acre: 1000, limit_kg: 2000, window_days: 150 }, /2200 kg.*150 days.*2000 kg.*2 acres/],
    ["repeat_within_hour", { other_entries: 1, other_slips: ["C07-00201"], nearest_minutes: 30, window_minutes: 60 }, /1 other entry.*60 minutes.*30 min.*C07-00201/],
    ["uniform_moisture", { readings: 10, min_pct: 11, max_pct: 11.2, range_pct: 0.2, max_range_pct: 0.2 }, /last 10.*11% to 11\.2%/],
    ["weight_pattern_change", { this_kg: 1600, median_kg: 500, ratio: 3, history_entries: 3 }, /1600 kg.*500 kg.*3 earlier/],
    ["moisture_pattern_change", { this_pct: 17, mean_pct: 10, shift_pct: 5, history_entries: 3 }, /17%.*10%.*5 points/],
  ];
  it.each(cases)("%s is explained in English from its stored values", (rule, details, pattern) => {
    const text = describeAnomaly(rule, details, "en");
    expect(text).toMatch(pattern);
    expect(text).not.toContain("?");
    expect(text).not.toMatch(/\{\w+\}/);
  });
  it.each(cases)("%s is explained in Marathi with no placeholder left over", (rule, details) => {
    const text = describeAnomaly(rule, details, "mr");
    expect(text).not.toMatch(/\{\w+\}/);
    expect(text).not.toContain("?");
    expect(text).toMatch(/[ऀ-ॿ]/);
  });
  it("has a label and a description for every rule, in both languages", () => {
    for (const lang of ["en", "mr"] as const) {
      const m = getPart6Messages(lang).anomalies;
      for (const [rule] of cases) {
        expect(m.rules[rule]).toBeTruthy();
        expect(m.detail[rule]).toBeTruthy();
      }
    }
  });
  it("never claims the thresholds are official", () => {
    expect(getPart6Messages("en").anomalies.assumptionBanner).toMatch(/assumption/i);
    expect(getPart6Messages("en").anomalies.assumptionBanner).toMatch(/not official/i);
    expect(getPart6Messages("en").settings.intro).toMatch(/not an agronomic or legal standard/i);
  });
});

// ---------------------------------------------------------------------------
describe("anomaly routes", () => {
  const manager = (extra: FakeSupabaseOptions = {}) => withClient({ user: USER, tables: { profiles: MANAGER_PROFILE }, ...extra });
  const operator = () => withClient({ user: USER, tables: { profiles: OPERATOR_PROFILE } });
  const calls: [string, () => Promise<Response>][] = [
    ["review anomaly", () => reviewAnomaly(post({ action: "reviewed" }), ctx())],
    ["save threshold", () => saveSetting(post({ key: "repeat_window_minutes", value: 90 }))],
  ];

  it.each(calls)("%s: signed-out is refused and never reaches the database", async (_n, call) => {
    const fake = withClient({ user: null });
    expect((await call()).status).toBe(401);
    expect(fake.rpcCalls).toEqual([]);
  });
  it.each(calls)("%s: an operator is refused and never reaches the database", async (_n, call) => {
    const fake = operator();
    expect((await call()).status).toBe(403);
    expect(fake.rpcCalls).toEqual([]);
    expect(fake.queriedTables).toEqual(["profiles"]);
  });

  it("reviews an anomaly through the database function with exactly the action and note", async () => {
    const fake = manager();
    const response = await reviewAnomaly(post({ action: "false_positive", note: "Two plots, both genuine" }), ctx());
    expect(response.status).toBe(200);
    expect(fake.rpcCalls).toEqual([{ name: "review_anomaly", args: { p_flag_id: FLAG, p_action: "false_positive", p_note: "Two plots, both genuine" } }]);
  });
  it("needs a note to confirm or clear an anomaly, but not to mark it reviewed", async () => {
    const fake = manager();
    expect((await reviewAnomaly(post({ action: "confirmed", note: "no" }), ctx())).status).toBe(422);
    expect((await reviewAnomaly(post({ action: "false_positive" }), ctx())).status).toBe(422);
    expect(fake.rpcCalls).toEqual([]);
    expect((await reviewAnomaly(post({ action: "reviewed" }), ctx())).status).toBe(200);
  });
  it("cannot be used to approve, reject or pay a purchase", async () => {
    const fake = manager();
    for (const action of ["approve", "approve_purchase", "reject", "pay", ""]) {
      expect((await reviewAnomaly(post({ action, note: "Looks fine to me" }), ctx())).status).toBe(422);
    }
    expect((await reviewAnomaly(post({ action: "reviewed", approve: true }), ctx())).status).toBe(422);
    expect(fake.rpcCalls).toEqual([]);
  });
  it("refuses a bad flag id", async () => {
    manager();
    expect((await reviewAnomaly(post({ action: "reviewed" }), ctx("nope"))).status).toBe(404);
  });
  it("maps database refusals to plain messages with no database text", async () => {
    manager({ rpc: () => ({ error: { code: "P0002", message: "ks:not_found" } }) });
    const response = await reviewAnomaly(post({ action: "reviewed" }), ctx());
    expect(response.status).toBe(404);
    expect(JSON.stringify(await response.json())).not.toContain("ks:");
  });
  it("passes a threshold change straight to the range-checked function, and refuses extra fields", async () => {
    const fake = manager();
    expect((await saveSetting(post({ key: "repeat_window_minutes", value: 90 }))).status).toBe(200);
    expect(fake.rpcCalls).toEqual([{ name: "update_anomaly_setting", args: { p_key: "repeat_window_minutes", p_value: 90 } }]);
    expect((await saveSetting(post({ key: "repeat_window_minutes", value: 90, sql: "x" }))).status).toBe(422);
    expect((await saveSetting(post({ key: "Robert'); drop table", value: 1 }))).status).toBe(422);
  });
  it("reports an out-of-range threshold plainly", async () => {
    manager({ rpc: () => ({ error: { code: "22023", message: "ks:setting_out_of_range" } }) });
    const response = await saveSetting(post({ key: "repeat_window_minutes", value: 100000 }));
    expect(response.status).toBe(422);
    expect((await response.json()).error).toMatch(/outside the allowed range/i);
  });
  it("explains why approving is refused while an anomaly is open, and when a note is missing", async () => {
    manager({ rpc: () => ({ error: { code: "23514", message: "ks:anomaly_open" } }) });
    const open = await reviewEntry(post({ decision: "approve" }), ctx("66666666-6666-4666-8666-666666666666"));
    expect(open.status).toBe(409);
    expect((await open.json()).error).toMatch(/open anomaly/i);
    manager({ rpc: () => ({ error: { code: "22023", message: "ks:note_required_confirmed" } }) });
    const note = await reviewEntry(post({ decision: "approve" }), ctx("66666666-6666-4666-8666-666666666666"));
    expect(note.status).toBe(422);
    expect((await note.json()).error).toMatch(/note/i);
  });
});

// ---------------------------------------------------------------------------
describe("payment preview and anomalies", () => {
  const row = (id: string, slip: string) => ({
    id,
    slip_no: slip,
    amount: "1000.00",
    farmer_id: "f1",
    centre_id: IDS.centre,
    farmer_members: { member_code: "FM00001", full_name: "Ramesh", farmer_bank_accounts: { holder_name: "Ramesh", account_number: "123456789012", ifsc: "TEST0000001", verified: true } },
  });
  it("leaves out entries whose anomaly has not been reviewed, and keeps the rest", async () => {
    withClient({
      user: USER,
      lists: { procurement_entries: [row("e1", "C07-00001"), row("e2", "C07-00002")], anomaly_flags: [{ entry_id: "e2" }] },
    });
    const { preview, error } = await previewPayment(current.client as SupabaseClient, { from: "2026-11-01", to: "2026-11-05", centreIds: [IDS.centre] });
    expect(error).toBe(false);
    expect(preview.payable).toEqual({ farmers: 1, entries: 1, amount: "1000.00" });
    expect(preview.groups[0].entryIds).toEqual(["e1"]);
  });
});

// ---------------------------------------------------------------------------
describe("reading metadata through the offline queue and sync", () => {
  const meta = { grossKg: { source: "ai_corrected" as const, aiValue: "860.0", aiConfidence: "high" as const }, moisturePct: { source: "manual" as const } };
  const input = { farmerId: IDS.farmer, crop: "soybean" as const, grade: "A" as const, grossKg: "850.0", tareKg: "12.0", moisturePct: "14.0", ratePerQuintal: "4850" };
  const sync: SyncContext = { operatorId: IDS.operator, centreId: IDS.centre, centreCode: "C07", deviceId: DEVICE_ID, now: new Date("2026-11-02T10:00:00.000Z"), maxFutureSkewMinutes: 10 };
  let counter = 0;

  async function ready() {
    const db = new LocalDatabase(`kisansetu-part6-${++counter}`, { indexedDB, IDBKeyRange });
    const deviceId = await getOrCreateDeviceId(db);
    await setSlipBlock(db, { centreCode: "C07", start: 100, end: 110 });
    return { db, context: { operatorId: IDS.operator, centreId: IDS.centre, deviceId } };
  }

  it("is stored with the queued entry but is not part of the tamper-evident hash", async () => {
    const { db, context } = await ready();
    const plain = await recordProcurement(db, input, { ...context, clientId: crypto.randomUUID(), now: new Date("2026-11-02T06:00:00Z") });
    const { db: db2, context: context2 } = await ready();
    const withMeta = await recordProcurement(db2, { ...input, readings: meta }, { ...context2, deviceId: context.deviceId, clientId: plain.clientId, now: new Date("2026-11-02T06:00:00Z") });
    expect(withMeta.readings).toEqual(meta);
    expect(plain.readings).toBeNull();
    // Same purchase facts, so the same hash with or without the metadata.
    expect(await computePayloadHash({ ...withMeta, readings: null })).toBe(await computePayloadHash({ ...plain }));
  });

  it("rejects metadata that is not one of the allowed shapes", () => {
    const base = { ...input, clientId: crypto.randomUUID() };
    expect(entryRecordSchema.safeParse({ ...base, readings: { grossKg: { source: "ai_approved" } } }).success).toBe(false);
    expect(entryRecordSchema.safeParse({ ...base, readings: { grossKg: { source: "manual", image: "data:..." } } }).success).toBe(false);
    expect(entryRecordSchema.safeParse({ ...base, readings: { bankAccount: "123" } }).success).toBe(false);
  });

  it("arrives in the server row so a manager can see how each figure was obtained", async () => {
    const repo = new MemoryRepo();
    const entry = await makeEntry({ readings: meta });
    const [result] = await processSyncBatch([entry], sync, repo);
    expect(result.outcome).toBe("accepted");
    expect(repo.entries.get(entry.clientId)?.reading_meta).toEqual(meta);
  });

  it("is null for an entry typed entirely by hand, and bad metadata rejects only that entry", async () => {
    const repo = new MemoryRepo();
    const plain = await makeEntry();
    await processSyncBatch([plain], sync, repo);
    expect(repo.entries.get(plain.clientId)?.reading_meta).toBeNull();
    const bad = { ...(await makeEntry({ slipNo: "C07-00002" })), readings: { grossKg: { source: "ai_approved" } } };
    const [result] = await processSyncBatch([bad as never], sync, repo);
    expect(result.outcome).toBe("rejected");
  });
});
