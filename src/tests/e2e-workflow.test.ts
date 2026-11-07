import "fake-indexeddb/auto";
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LocalDatabase } from "@/lib/db/local";
import { verifyPayloadHash } from "@/lib/offline/integrity";
import { getOrCreateDeviceId, getPendingEntries, recordProcurement, setSlipBlock } from "@/lib/offline/queue";
import { downloadReferenceData, getCachedRate, searchCachedMembers, type BootstrapPage } from "@/lib/offline/reference-data";
import { queueSlipSms } from "@/lib/offline/sms-queue";
import { syncPending } from "@/lib/offline/sync";
import { buildBankFile, type BankFileRow } from "@/lib/payments/bank-file";
import { buildSlip } from "@/lib/slip/slip";
import { buildSmsBody } from "@/lib/sms/message";
import { processSyncBatch, type EntryRow, type SyncRepository } from "@/lib/services/sync-service";
import { syncRequestSchema } from "@/lib/validation/procurement";
import { calculateProcurement } from "@/lib/calculations/procurement";

/**
 * The full workflow from the brief, run end to end with no mocks of our own code:
 * the real migrations (in an in-memory Postgres, acting as each signed-in role),
 * the real offline store and queue, the real sync service, slip, SMS text,
 * payment-run functions and bank file builder.
 *
 * What is NOT exercised here: the browser UI, Supabase Auth and the HTTP layer
 * (route handlers are covered separately in authorization.test.ts and friends).
 * Everything in this file is demo data.
 */

const SUPABASE_DIR = path.resolve(import.meta.dirname, "../../supabase");
const MANAGER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OPERATOR = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OTHER_OPERATOR = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

let pg: PGlite;
let c07: string;
let c12: string;

async function asUser<T>(uid: string, fn: () => Promise<T>): Promise<T> {
  await pg.exec(`select set_config('app.uid', '${uid}', false); set role authenticated;`);
  try {
    return await fn();
  } finally {
    await pg.exec("reset role; select set_config('app.uid', '', false);");
  }
}
const q = <T extends object>(sql: string, params: unknown[] = []) => pg.query<T>(sql, params).then((r) => r.rows);

/** The sync repository, backed by the real database and running as the signed-in operator. */
function pgRepository(operatorId: string): SyncRepository {
  return {
    findEntryByClientId: (id) =>
      asUser(operatorId, async () => {
        const [row] = await q<{ payload_hash: string; server_received_at: string }>(
          "select payload_hash, server_received_at from procurement_entries where client_id = $1", [id]);
        return row ? { payloadHash: row.payload_hash, serverReceivedAt: new Date(row.server_received_at).toISOString() } : null;
      }),
    isKnownHash: (deviceId, hash) =>
      asUser(operatorId, async () => {
        const [a] = await q<{ n: number }>("select count(*)::int n from procurement_entries where device_id = $1 and payload_hash = $2", [deviceId, hash]);
        const [b] = await q<{ n: number }>("select count(*)::int n from sync_events where device_id = $1 and detail->>'payloadHash' = $2", [deviceId, hash]);
        return a.n + b.n > 0;
      }),
    farmerExists: (id) =>
      asUser(operatorId, async () => (await q("select 1 from farmer_members where id = $1 and active", [id])).length > 0),
    getRate: (date, crop, grade) =>
      asUser(operatorId, async () => {
        const [r] = await q<{ rate_per_quintal: string }>("select rate_per_quintal from daily_prices where price_date = $1 and crop = $2 and grade = $3", [date, crop, grade]);
        return r ? String(r.rate_per_quintal) : null;
      }),
    insertEntry: (row: EntryRow) =>
      asUser(operatorId, async () => {
        const keys = Object.keys(row) as (keyof EntryRow)[];
        const values = keys.map((k) => (k === "reading_meta" || k === "flag_reasons" ? (k === "flag_reasons" ? row[k] : row[k] === null ? null : JSON.stringify(row[k])) : row[k]));
        try {
          const [stored] = await q<{ server_received_at: string; flag_reasons: string[] }>(
            `insert into procurement_entries (${keys.join(", ")}) values (${keys.map((k, i) => (k === "reading_meta" ? `$${i + 1}::jsonb` : `$${i + 1}`)).join(", ")})
             returning server_received_at, flag_reasons`, values);
          return { status: "inserted" as const, serverReceivedAt: new Date(stored.server_received_at).toISOString(), flagReasons: stored.flag_reasons as never };
        } catch (error) {
          const e = error as { code?: string; message: string };
          if (e.code === "23505") return { status: e.message.includes("slip_no") ? ("duplicate_slip" as const) : ("duplicate_client" as const) };
          throw error;
        }
      }),
    logEvent: (event) =>
      asUser(operatorId, async () => {
        await q("insert into sync_events (device_id, operator_id, client_id, outcome, detail) values ($1, $2, $3, $4, $5::jsonb)", [
          event.deviceId, event.operatorId, /^[0-9a-f-]{36}$/i.test(event.clientId ?? "") ? event.clientId : null, event.outcome, JSON.stringify(event.detail),
        ]);
      }),
  };
}

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(`
    create schema auth;
    create table auth.users (id uuid primary key, email text, raw_app_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
    create role authenticated;
    create role anon;
    grant usage on schema auth to authenticated, anon;
  `);
  for (const file of fs.readdirSync(path.join(SUPABASE_DIR, "migrations")).sort()) {
    await pg.exec(fs.readFileSync(path.join(SUPABASE_DIR, "migrations", file), "utf8"));
  }
  await pg.exec(fs.readFileSync(path.join(SUPABASE_DIR, "seed.sql"), "utf8"));
  await pg.exec(`
    grant usage on schema public to authenticated, anon;
    grant all on all tables in schema public to authenticated, anon;
    grant all on all sequences in schema public to authenticated;
    grant execute on all functions in schema public to authenticated;
    revoke execute on function anomaly_setting(text), anomaly_findings(procurement_entries) from authenticated, public;
  `);
  c07 = (await q<{ id: string }>("select id from centres where code = 'C07'"))[0].id;
  c12 = (await q<{ id: string }>("select id from centres where code = 'C12'"))[0].id;
  await pg.exec(`
    insert into auth.users (id, email) values ('${MANAGER}', 'manager@kisansetu.demo'), ('${OPERATOR}', 'operator.c07@kisansetu.demo'), ('${OTHER_OPERATOR}', 'operator.c12@kisansetu.demo');
    insert into profiles (id, full_name, role, centre_id, active) values
      ('${MANAGER}', 'Demo Office Manager', 'office_manager', null, true),
      ('${OPERATOR}', 'Demo Operator C07', 'centre_operator', '${c07}', true),
      ('${OTHER_OPERATOR}', 'Demo Operator C12', 'centre_operator', '${c12}', true);
  `);
}, 60_000);
afterAll(async () => {
  await pg.close();
});

// Shared state across the ordered steps below.
const s = {
  farmerId: "",
  today: "",
  db: undefined as unknown as LocalDatabase,
  deviceId: "",
  online: true,
  clientIds: [] as string[],
  runId: "",
  itemIds: [] as string[],
};

describe("KisanSetu end-to-end workflow (demo data)", () => {
  it("1. the office manager signs in: the database recognises the manager role", async () => {
    const [{ role }] = await asUser(MANAGER, () => q<{ role: string }>("select app_role() as role"));
    expect(role).toBe("office_manager");
  });

  it("2. the office manager creates a farmer with a bank account and verifies it", async () => {
    const created = await asUser(MANAGER, async () =>
      (await q<{ r: { id: string; member_code: string } }>(
        "select register_farmer($1::jsonb) as r",
        [JSON.stringify({
          full_name: "Demo Farmer One", village: "Demo Village", centre_id: c07, phone: "9876500001",
          land_acres: 12, crops: ["soybean", "tur"], active: true,
          bank: { holder_name: "Demo Farmer One", account_number: "000123456789", ifsc: "DEMO0000001" },
        })])).map((x) => x.r)[0]);
    s.farmerId = created.id;
    expect(created.member_code).toMatch(/^FM\d+$/);
    await asUser(MANAGER, () => q("select verify_farmer_bank($1)", [s.farmerId]));
    const [bank] = await q<{ verified: boolean }>("select verified from farmer_bank_accounts where member_id = $1", [s.farmerId]);
    expect(bank.verified).toBe(true);
  });

  it("3. the office manager publishes today's prices (draft, then publish)", async () => {
    [{ today: s.today }] = await q<{ today: string }>("select ist_today()::text as today");
    await asUser(MANAGER, () => q("select save_price_drafts($1::date, $2::jsonb, $3)", [
      s.today, JSON.stringify([{ crop: "soybean", grade: "A", rate: 4925 }, { crop: "tur", grade: "A", rate: 7310 }]),
      // The demo seed already publishes a rate for today, so this is a correction and needs a reason.
      "Market rate moved this morning",
    ]));
    const ids = (await q<{ id: string }>("select id from price_versions where price_date = $1 and status = 'draft'", [s.today])).map((r) => r.id);
    expect(ids).toHaveLength(2);
    const [{ n }] = await asUser(MANAGER, () => q<{ n: number }>("select publish_prices($1::uuid[]) as n", [ids]));
    expect(Number(n)).toBe(2);
    const live = await q<{ rate_per_quintal: string }>("select rate_per_quintal from daily_prices where price_date = $1 and crop = 'soybean' and grade = 'A'", [s.today]);
    expect(Number(live[0].rate_per_quintal)).toBe(4925);
  });

  it("4. the operator signs in as a centre operator, tied to one centre", async () => {
    const [p] = await asUser(OPERATOR, () => q<{ role: string; centre: string }>("select app_role() as role, app_centre_id()::text as centre"));
    expect(p).toEqual({ role: "centre_operator", centre: c07 });
  });

  it("5. the operator downloads farmer and price data into the phone's local database", async () => {
    s.db = new LocalDatabase("kisansetu-e2e", { indexedDB, IDBKeyRange });
    s.deviceId = await getOrCreateDeviceId(s.db);
    await setSlipBlock(s.db, { centreCode: "C07", start: 70001, end: 70010 });
    const bootstrap: typeof fetch = async () => {
      const page: BootstrapPage = await asUser(OPERATOR, async () => {
        const members = await q<Record<string, unknown>>("select id, member_code, full_name, village, phone, land_acres, centre_id, crops from farmer_members where active");
        const prices = await q<Record<string, unknown>>("select price_date::text as price_date, crop, grade, rate_per_quintal, version, published_at from daily_prices");
        return {
          members: members.map((m) => ({ id: m.id as string, memberCode: m.member_code as string, fullName: m.full_name as string, village: m.village as string, phone: (m.phone as string) ?? null, landAcres: Number(m.land_acres), centreId: (m.centre_id as string) ?? null, crops: m.crops as never })),
          prices: prices.map((p) => ({ priceDate: String(p.price_date).slice(0, 10), crop: p.crop as never, grade: p.grade as never, ratePerQuintal: String(p.rate_per_quintal), version: Number(p.version ?? 1) })),
          nextCursor: null,
          serverTime: new Date().toISOString(),
        };
      });
      return new Response(JSON.stringify(page), { status: 200 });
    };
    const result = await downloadReferenceData(s.db, { fetchImpl: bootstrap });
    expect(result.members).toBeGreaterThan(0);
    expect((await searchCachedMembers(s.db, "Demo Farmer One"))[0]?.id).toBe(s.farmerId);
    expect(await getCachedRate(s.db, s.today, "soybean", "A")).toBe("4925.00");
    // No bank details ever reach the phone.
    expect(JSON.stringify(await s.db.members.toArray())).not.toMatch(/account|ifsc|000123456789/i);
  });

  it("6-9. offline, the operator records a purchase: net weight and amount are calculated", async () => {
    s.online = false;
    const ctx = { operatorId: OPERATOR, centreId: c07, deviceId: s.deviceId };
    const input = { farmerId: s.farmerId, crop: "soybean" as const, grade: "A" as const, grossKg: "860.0", tareKg: "12.0", moisturePct: "14.0", ratePerQuintal: "4925", rateDate: s.today };
    // Typed by hand, then a second purchase whose weight the operator confirmed after an AI suggestion.
    const first = await recordProcurement(s.db, input, { ...ctx, now: new Date(Date.now() - 40 * 60_000) });
    const second = await recordProcurement(
      s.db,
      { ...input, grossKg: "430.0", tareKg: "5.0", moisturePct: "11.0", readings: { grossKg: { source: "ai_confirmed", aiValue: "430.0", aiConfidence: "high" } } },
      { ...ctx, now: new Date(Date.now() - 20 * 60_000) },
    );
    s.clientIds = [first.clientId, second.clientId];

    // 860 - 12 = 848 kg, less 2% moisture over 12% = 831.0 kg; 831.0 kg x 4925 / 100 = 40,926.75
    expect(first.netKg).toBe("831.0");
    expect(first.amount).toBe("40926.75");
    expect(calculateProcurement(first).amount).toBe(first.amount);
    expect(second.readings?.grossKg?.source).toBe("ai_confirmed");
    expect(await verifyPayloadHash(first)).toBe(true);
    expect((await getPendingEntries(s.db, 10, OPERATOR)).length).toBe(2);
  });

  it("10-11. a bilingual digital slip is generated and an SMS is queued, both while offline", async () => {
    const entry = (await s.db.entries.where("clientId").equals(s.clientIds[0]).first())!;
    const slipInput = {
      slipNo: entry.slipNo, farmerName: "Demo Farmer One", farmerCode: "FM", village: "Demo Village", centreName: "Ganjur", centreCode: "C07",
      crop: entry.crop, grade: entry.grade, grossKg: entry.grossKg, tareKg: entry.tareKg, moisturePct: entry.moisturePct,
      ratePerQuintal: entry.ratePerQuintal, netKg: entry.netKg, amount: entry.amount, rateDate: s.today, rateVersion: 1,
      recordedAt: entry.deviceRecordedAt, serverReceivedAt: null, paymentStatus: "unpaid" as const,
    };
    const slip = buildSlip(slipInput);
    expect(slip.headline.amount).toContain("40,926.75");
    expect(slip.headline.netKg).toContain("831");
    expect(slip.confirmation.en).toMatch(/not yet|pending|waiting/i);
    const sms = await queueSlipSms(s.db, { entryClientId: entry.clientId, operatorId: OPERATOR, farmerId: s.farmerId });
    expect(sms.status).toBe("queued");
    expect(buildSmsBody(slipInput, "mr")).toContain("40,926.75");
  });

  it("12-13. the operator reconnects and the entries synchronise, once each", async () => {
    s.online = true;
    const fetchImpl: typeof fetch = async (_url, init) => {
      const parsed = syncRequestSchema.safeParse(JSON.parse(String(init?.body)));
      if (!parsed.success) return new Response("{}", { status: 400 });
      const results = await processSyncBatch(
        parsed.data.entries,
        { operatorId: OPERATOR, centreId: c07, centreCode: "C07", deviceId: parsed.data.deviceId, now: new Date(), maxFutureSkewMinutes: 10 },
        pgRepository(OPERATOR),
      );
      return new Response(JSON.stringify({ results, serverTime: new Date().toISOString() }), { status: 200 });
    };
    const summary = await syncPending(s.db, { deviceId: s.deviceId, operatorId: OPERATOR, fetchImpl });
    expect(summary).toMatchObject({ attempted: 2, rejected: 0 });
    expect(summary.accepted + summary.flagged).toBe(2);

    // Syncing again sends nothing and creates no duplicates.
    expect((await syncPending(s.db, { deviceId: s.deviceId, operatorId: OPERATOR, fetchImpl })).attempted).toBe(0);
    const rows = await asUser(MANAGER, () => q<{ slip_no: string; reading_meta: unknown; net_kg: string; amount: string }>("select slip_no, reading_meta, net_kg, amount from procurement_entries where farmer_id = $1 order by slip_no", [s.farmerId]));
    expect(rows).toHaveLength(2);
    expect(Number(rows[0].amount)).toBe(40926.75);
    expect(rows[1].reading_meta).toMatchObject({ grossKg: { source: "ai_confirmed" } });
  });

  it("12b. a lost reply is simulated: the same entries are sent again and the server keeps one copy", async () => {
    const fetchImpl: typeof fetch = async (_url, init) => {
      const parsed = syncRequestSchema.parse(JSON.parse(String(init?.body)));
      const results = await processSyncBatch(
        parsed.entries,
        { operatorId: OPERATOR, centreId: c07, centreCode: "C07", deviceId: parsed.deviceId, now: new Date(), maxFutureSkewMinutes: 10 },
        pgRepository(OPERATOR),
      );
      return new Response(JSON.stringify({ results, serverTime: new Date().toISOString() }), { status: 200 });
    };
    // The phone never saw the first reply, so it still thinks both are pending.
    await s.db.entries.toCollection().modify({ syncStatus: "pending", syncAttempts: 0 });
    const again = await syncPending(s.db, { deviceId: s.deviceId, operatorId: OPERATOR, fetchImpl });
    expect(again.duplicates).toBe(2);
    const [{ n }] = await q<{ n: number }>("select count(*)::int n from procurement_entries where farmer_id = $1", [s.farmerId]);
    expect(n).toBe(2);
  });

  it("14. the manager reviews: the clean entry arrived approved, the close-together one is held with a reason", async () => {
    const rows = await asUser(MANAGER, () => q<{ slip_no: string; approval_status: string; flag_reasons: string[] }>("select slip_no, approval_status, flag_reasons from procurement_entries where farmer_id = $1 order by device_recorded_at", [s.farmerId]));
    expect(rows[0]).toMatchObject({ approval_status: "approved", flag_reasons: [] });
    expect(rows[1].approval_status).toBe("held");
    expect(rows[1].flag_reasons).toContain("repeat_within_hour");
    // Nothing was rejected by the machine.
    expect(rows.some((r) => r.approval_status === "rejected")).toBe(false);
  });

  it("15. the manager reviews the anomaly and approves the held entry; approval is refused until then", async () => {
    const [held] = await q<{ id: string }>("select id from procurement_entries where farmer_id = $1 and approval_status = 'held'", [s.farmerId]);
    await expect(asUser(MANAGER, () => q("select review_entry($1, 'approve', null)", [held.id]))).rejects.toThrow(/ks:anomaly_open/);
    const [flag] = await q<{ id: string }>("select id from anomaly_flags where entry_id = $1", [held.id]);
    await asUser(MANAGER, () => q("select review_anomaly($1, 'false_positive', 'Two lots from different plots')", [flag.id]));
    await asUser(MANAGER, () => q("select review_entry($1, 'approve', null)", [held.id]));
    const [after] = await q<{ approval_status: string }>("select approval_status from procurement_entries where id = $1", [held.id]);
    expect(after.approval_status).toBe("approved");
    const actions = (await q<{ action: string }>("select action from procurement_audit_logs where entry_id = $1 order by created_at, id", [held.id])).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(["created", "anomaly_flagged", "anomaly_false_positive"]));
  });

  it("16. the manager generates a payment run: one payment per farmer, totals exact", async () => {
    const result = await asUser(MANAGER, async () =>
      (await q<{ r: { run_id: string; entry_count: number; item_count: number; total_amount: string } }>(
        "select create_payment_run($1::date, $1::date, array[$2]::uuid[]) as r", [s.today, c07]))[0].r);
    s.runId = result.run_id;
    expect(result.entry_count).toBe(2);
    expect(result.item_count).toBe(1);
    // 40,926.75 + (430-5 = 425.0 kg, no moisture deduction, x 4925 / 100 = 20,931.25)
    expect(Number(result.total_amount)).toBe(61858);
    s.itemIds = (await q<{ id: string }>("select id from payment_items where run_id = $1", [s.runId])).map((r) => r.id);
    expect(s.itemIds).toHaveLength(1);
    const dup = await asUser(MANAGER, () => q("select create_payment_run($1::date, $1::date, array[$2]::uuid[])", [s.today, c07])).catch((e: Error) => e.message);
    expect(String(dup)).toMatch(/ks:no_eligible_entries/);
  });

  it("17. the bank CSV can be downloaded only after approval, and has the six required fields", async () => {
    await expect(asUser(MANAGER, () => q("select start_bank_file($1)", [s.runId]))).rejects.toThrow(/ks:not_approved/);
    await asUser(MANAGER, () => q("select approve_payment_run($1)", [s.runId]));
    const { file_name } = (await asUser(MANAGER, () => q<{ r: { file_name: string } }>("select start_bank_file($1) as r", [s.runId])))[0].r;
    const [run] = await q<{ run_no: string; status: string }>("select run_no, status from payment_runs where id = $1", [s.runId]);
    const items = await q<{ farmer_code: string; beneficiary_name: string; account_number: string; ifsc: string; amount: string; payment_ref: string }>(
      "select farmer_code, beneficiary_name, account_number, ifsc, amount, payment_ref from payment_items where run_id = $1", [s.runId]);
    const rows: BankFileRow[] = items.map((i) => ({ beneficiaryName: i.beneficiary_name, accountNumber: i.account_number, ifsc: i.ifsc, amount: Number(i.amount).toFixed(2), paymentRef: i.payment_ref, runNo: run.run_no, farmerCode: i.farmer_code }));
    const csv = buildBankFile(rows);
    expect(file_name).toMatch(/^KISANSETU-MOCK-/);
    expect(csv.content.split("\r\n")[0]).toBe("beneficiary_name,account_number,ifsc,amount,payment_ref,payment_run_id");
    expect(csv.content).toContain("Demo Farmer One,000123456789,DEMO0000001,61858.00,");
    expect(csv.total).toBe("61858.00");
    expect(run.status).toBe("file_generated");
  });

  it("18-19. the manager simulates bank success and the farmer's payment status updates", async () => {
    await asUser(MANAGER, () => q("select simulate_bank_response($1::uuid[], 'paid', null)", [s.itemIds]));
    const entries = await q<{ payment_status: string }>("select payment_status from procurement_entries where farmer_id = $1", [s.farmerId]);
    expect(entries.map((e) => e.payment_status)).toEqual(["paid", "paid"]);
    const [item] = await q<{ status: string; bank_reference: string }>("select status, bank_reference from payment_items where id = $1", [s.itemIds[0]]);
    expect(item.status).toBe("paid");
    expect(item.bank_reference).toBeTruthy();
    // The slip now says paid.
    const entry = (await s.db.entries.where("clientId").equals(s.clientIds[0]).first())!;
    const slip = buildSlip({ slipNo: entry.slipNo, farmerName: "Demo Farmer One", farmerCode: "FM", village: "V", centreName: "Ganjur", centreCode: "C07", crop: entry.crop, grade: entry.grade, grossKg: entry.grossKg, tareKg: entry.tareKg, moisturePct: entry.moisturePct, ratePerQuintal: entry.ratePerQuintal, netKg: entry.netKg, amount: entry.amount, recordedAt: entry.deviceRecordedAt, serverReceivedAt: new Date().toISOString(), paymentStatus: "paid" });
    expect(slip.payment.status).toBe("paid");
    // A second "success" for a settled payment is refused: no double settlement.
    await expect(asUser(MANAGER, () => q("select simulate_bank_response($1::uuid[], 'paid', null)", [s.itemIds]))).rejects.toThrow(/ks:item_not_processing/);
  });

  it("the other centre's operator cannot see this farmer's purchases or the payment run", async () => {
    expect(await asUser(OTHER_OPERATOR, () => q("select 1 from procurement_entries where farmer_id = $1", [s.farmerId]))).toEqual([]);
    expect(await asUser(OTHER_OPERATOR, () => q("select 1 from payment_items"))).toEqual([]);
    expect(await asUser(OPERATOR, () => q("select 1 from payment_items"))).toEqual([]);
  });
});
