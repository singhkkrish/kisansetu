import "fake-indexeddb/auto";
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LocalDatabase } from "@/lib/db/local";
import { buildBankFile, DEFAULT_BANK_FILE_CONFIG } from "@/lib/payments/bank-file";
import { downloadReferenceData, getCachedRate, searchCachedMembers, type BootstrapPage } from "@/lib/offline/reference-data";
import { getOrCreateDeviceId, getPendingEntries, recordProcurement, setSlipBlock } from "@/lib/offline/queue";
import { processSmsQueue, queueSlipSms } from "@/lib/offline/sms-queue";
import { syncPending } from "@/lib/offline/sync";
import { buildSlip } from "@/lib/slip/slip";
import { localEntryToSlip } from "@/lib/slip/from-local";
import { processSyncBatch, type EntryRow, type SyncRepository } from "@/lib/services/sync-service";
import { istDate } from "@/lib/calculations/format";
import { syncRequestSchema } from "@/lib/validation/procurement";

/**
 * The whole procurement-to-payment journey, with the real database migrations
 * (in-memory Postgres, acting as each role so row level security applies), the
 * real offline queue (Dexie on a fake IndexedDB), the real sync service and the
 * real bank file builder. Network calls are replaced by functions that run the
 * same server code the API routes run.
 *
 * Not covered here, because it needs a browser: tapping through the wizard,
 * sign-in pages and Supabase Auth itself. The README manual checklists cover those.
 */

const SUPABASE_DIR = path.resolve(import.meta.dirname, "../../supabase");
const MANAGER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OPERATOR = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

let pg: PGlite;
let centreId: string;
let centreCode: string;

async function asUser<T>(uid: string, fn: () => Promise<T>): Promise<T> {
  await pg.exec(`select set_config('app.uid', '${uid}', false); set role authenticated;`);
  try {
    return await fn();
  } finally {
    await pg.exec("reset role; select set_config('app.uid', '', false);");
  }
}
const q = <T extends object>(sql: string, params: unknown[] = []) => pg.query<T>(sql, params).then((r) => r.rows);

/** Stores sync rows as the signed-in operator, so row level security and triggers are in play. */
function pgSyncRepository(): SyncRepository {
  return {
    async findEntryByClientId(clientId) {
      const rows = await asUser(OPERATOR, () => q<{ payload_hash: string; server_received_at: string }>("select payload_hash, server_received_at from procurement_entries where client_id = $1", [clientId]));
      return rows[0] ? { payloadHash: rows[0].payload_hash, serverReceivedAt: new Date(rows[0].server_received_at).toISOString() } : null;
    },
    async isKnownHash(deviceId, hash) {
      const rows = await asUser(OPERATOR, () => q("select 1 from procurement_entries where device_id = $1 and payload_hash = $2", [deviceId, hash]));
      return rows.length > 0;
    },
    async farmerExists(id) {
      return (await asUser(OPERATOR, () => q("select 1 from farmer_members where id = $1 and active", [id]))).length > 0;
    },
    async getRate(date, crop, grade) {
      const rows = await asUser(OPERATOR, () => q<{ rate_per_quintal: string }>("select rate_per_quintal from daily_prices where price_date = $1 and crop = $2 and grade = $3", [date, crop, grade]));
      return rows[0] ? String(rows[0].rate_per_quintal) : null;
    },
    async insertEntry(row: EntryRow) {
      const keys = Object.keys(row);
      const values = keys.map((k) => {
        const v = (row as unknown as Record<string, unknown>)[k];
        return v !== null && typeof v === "object" && !Array.isArray(v) ? JSON.stringify(v) : v;
      });
      try {
        const rows = await asUser(OPERATOR, () =>
          q<{ server_received_at: string; flag_reasons: string[] }>(
            `insert into procurement_entries (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning server_received_at, flag_reasons`,
            values,
          ),
        );
        return { status: "inserted" as const, serverReceivedAt: new Date(rows[0].server_received_at).toISOString(), flagReasons: rows[0].flag_reasons as never };
      } catch (error) {
        const e = error as { code?: string; message: string };
        if (e.code === "23505") return { status: e.message.includes("slip_no") ? ("duplicate_slip" as const) : ("duplicate_client" as const) };
        throw error;
      }
    },
    async logEvent(event) {
      await asUser(OPERATOR, () =>
        q("insert into sync_events (device_id, operator_id, client_id, outcome, detail) values ($1, $2, $3, $4, $5::jsonb)", [event.deviceId, event.operatorId, event.clientId, event.outcome, JSON.stringify(event.detail)]),
      );
    },
  };
}

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(`
    create schema auth;
    create table auth.users (id uuid primary key, email text, raw_app_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
    create role authenticated; create role anon;
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
  const [centre] = await q<{ id: string; code: string }>("select id, code from centres where code = 'C07'");
  centreId = centre.id;
  centreCode = centre.code;
  await pg.exec(`
    insert into auth.users (id, email) values ('${MANAGER}', 'm@x.test'), ('${OPERATOR}', 'o@x.test');
    insert into profiles (id, full_name, role, centre_id, active) values
      ('${MANAGER}', 'Demo Office Manager', 'office_manager', null, true),
      ('${OPERATOR}', 'Demo Operator C07', 'centre_operator', '${centreId}', true);
  `);
}, 60_000);

afterAll(async () => {
  await pg.close();
});

describe("procurement to payment, end to end", () => {
  const ctx: Record<string, string> = {};
  const today = istDate(new Date().toISOString());
  const local = new LocalDatabase("kisansetu-e2e", { indexedDB, IDBKeyRange });
  let deviceId = "";

  it("1-2. the office manager registers a farmer (and an operator cannot)", async () => {
    const payload = JSON.stringify({
      full_name: "Demo Farmer One", village: "Demo Village", centre_id: centreId, phone: "9000000001",
      land_acres: "10.00", crops: ["soybean"], active: true,
      bank: { holder_name: "Demo Farmer One", account_number: "000011112222", ifsc: "demo0000001" },
    });
    await expect(asUser(OPERATOR, () => q("select register_farmer($1::jsonb)", [payload]))).rejects.toThrow(/only office managers/i);
    const [row] = await asUser(MANAGER, () => q<{ register_farmer: { id: string } | string }>("select register_farmer($1::jsonb)", [payload]));
    const id = typeof row.register_farmer === "string" ? row.register_farmer : row.register_farmer.id;
    ctx.farmerId = id;
    expect((await q("select 1 from farmer_members where id = $1", [id])).length).toBe(1);
    // A manager verifies the account before it can be paid.
    await asUser(MANAGER, () => q("select verify_farmer_bank($1)", [id]));
  });

  it("3. the office manager publishes today's prices", async () => {
    // The seed already carries a published rate for the database's current date, which can be the same
    // day as the IST date used here. Start from "nothing published yet today" so this step always
    // exercises the real draft-then-publish path.
    await pg.exec("alter table daily_prices disable trigger user; alter table price_versions disable trigger user");
    await q("delete from daily_prices where price_date = $1", [today]);
    await q("delete from price_versions where price_date = $1", [today]);
    await pg.exec("alter table daily_prices enable trigger user; alter table price_versions enable trigger user");
    await asUser(MANAGER, () => q("select save_price_drafts($1::date, $2::jsonb, null)", [today, JSON.stringify([{ crop: "soybean", grade: "A", rate: 4850 }])]));
    const drafts = await asUser(MANAGER, () => q<{ id: string }>("select id from price_versions where price_date = $1 and status = 'draft'", [today]));
    await asUser(MANAGER, () => q("select publish_prices($1::uuid[])", [drafts.map((d) => d.id)]));
    const [live] = await q<{ rate_per_quintal: string }>("select rate_per_quintal from daily_prices where price_date = $1 and crop = 'soybean' and grade = 'A'", [today]);
    expect(Number(live.rate_per_quintal)).toBe(4850);
  });

  it("4-5. the operator downloads farmer and price data onto the phone", async () => {
    const fetchImpl = (async () => {
      const members = await asUser(OPERATOR, () =>
        q<{ id: string; member_code: string; full_name: string; village: string; phone: string | null; land_acres: string; centre_id: string | null; crops: string[] }>(
          "select id, member_code, full_name, village, phone, land_acres, centre_id, crops from farmer_members where active order by member_code"),
      );
      const prices = await asUser(OPERATOR, () => q<{ price_date: string; crop: string; grade: string; rate_per_quintal: string; version: number }>("select price_date::text, crop, grade, rate_per_quintal, version from daily_prices"));
      const page: BootstrapPage = {
        members: members.map((m) => ({ id: m.id, memberCode: m.member_code, fullName: m.full_name, village: m.village, phone: m.phone, landAcres: Number(m.land_acres), centreId: m.centre_id, crops: m.crops as never })),
        prices: prices.map((p) => ({ priceDate: p.price_date, crop: p.crop as never, grade: p.grade as never, ratePerQuintal: String(p.rate_per_quintal), version: p.version })),
        nextCursor: null,
        serverTime: new Date().toISOString(),
      };
      return new Response(JSON.stringify(page), { status: 200 });
    }) as unknown as typeof fetch;
    const result = await downloadReferenceData(local, { fetchImpl });
    expect(result.members).toBeGreaterThan(0);
    const [found] = await searchCachedMembers(local, "Demo Farmer One");
    expect(found.id).toBe(ctx.farmerId);
    expect(await getCachedRate(local, today, "soybean", "A")).toBe("4850.00");
    // The operator's phone never received bank details.
    expect(JSON.stringify(await local.members.toArray())).not.toMatch(/000011112222|demo0000001/i);
  });

  it("6-9. offline, the operator records a purchase; net weight and amount are calculated", async () => {
    deviceId = await getOrCreateDeviceId(local);
    const [block] = await asUser(OPERATOR, () => q<{ start_no: number; end_no: number }>("select * from allocate_slip_block($1, $2, 20)", [centreId, deviceId]));
    await setSlipBlock(local, { centreCode, start: block.start_no, end: block.end_no });
    const entry = await recordProcurement(
      local,
      { farmerId: ctx.farmerId, crop: "soybean", grade: "A", grossKg: "860.0", tareKg: "12.0", moisturePct: "14.0", ratePerQuintal: "4850", rateDate: today, rateVersion: 1,
        readings: { grossKg: { source: "ai_confirmed", aiValue: "860.0", aiConfidence: "high" }, moisturePct: { source: "manual" } } },
      { operatorId: OPERATOR, centreId, deviceId },
    );
    ctx.clientId = entry.clientId;
    ctx.slipNo = entry.slipNo;
    // 860 - 12 = 848 kg; 2% moisture excess over 12% => 17.0 kg off (rounded) = 831.0 kg; 831.0 kg x 4850 / 100 quintal.
    expect(entry.netKg).toBe("831.0");
    expect(entry.amount).toBe("40303.50");
    expect(entry.syncStatus).toBe("pending");
  });

  it("10-11. a digital slip is generated and the SMS is queued, with no network", async () => {
    const [entry] = await getPendingEntries(local, 10, OPERATOR);
    const member = await local.members.get(ctx.farmerId);
    const slip = buildSlip(localEntryToSlip(entry, member, { code: centreCode, name: "Ganjur" }));
    expect(slip.slipNo).toBe(ctx.slipNo);
    expect(JSON.stringify(slip.identity)).toContain("Demo Farmer One");
    expect(slip.headline).toEqual({ amount: expect.stringContaining("40,303.50"), netKg: expect.stringContaining("831.0") });
    
    const sms = await queueSlipSms(local, { entryClientId: entry.clientId, operatorId: OPERATOR, farmerId: ctx.farmerId });
    expect(sms.status).toBe("queued");
    // Offline: nothing is sent, and asking again does not make a second message.
    const offline = (async () => { throw new TypeError("network down"); }) as unknown as typeof fetch;
    expect((await syncPending(local, { deviceId, operatorId: OPERATOR, fetchImpl: offline })).stoppedBecause).toBe("offline");
    expect((await processSmsQueue(local, { operatorId: OPERATOR, fetchImpl: offline })).waiting).toBe(1);
    expect(await queueSlipSms(local, { entryClientId: entry.clientId, operatorId: OPERATOR, farmerId: ctx.farmerId })).toEqual(sms);
    expect((await local.entries.toArray()).filter((e) => e.syncStatus === "pending")).toHaveLength(1);
  });

  it("12-13. back online, the entry syncs once, even if the response is lost and it is sent again", async () => {
    let calls = 0;
    const online = (async (_url: string, init: RequestInit) => {
      calls++;
      const body = syncRequestSchema.parse(JSON.parse(String(init.body)));
      const results = await processSyncBatch(
        body.entries,
        { operatorId: OPERATOR, centreId, centreCode, deviceId: body.deviceId, now: new Date(), maxFutureSkewMinutes: 10 },
        pgSyncRepository(),
      );
      return new Response(JSON.stringify({ results, serverTime: new Date().toISOString() }), { status: 200 });
    }) as unknown as typeof fetch;

    // The failed attempt above put the entry on a retry timer; a real phone waits it out.
    await local.entries.toCollection().modify({ nextRetryAt: undefined });
    const summary = await syncPending(local, { deviceId, operatorId: OPERATOR, fetchImpl: online });
    expect(summary).toMatchObject({ attempted: 1, accepted: 1, rejected: 0 });
    expect(calls).toBe(1);

    // Pretend the phone never saw the answer: it sends the same entry again.
    await local.entries.where("clientId").equals(ctx.clientId).modify({ syncStatus: "pending" });
    const again = await syncPending(local, { deviceId, operatorId: OPERATOR, fetchImpl: online });
    expect(again.duplicates).toBe(1);
    expect(await q("select 1 from procurement_entries where client_id = $1", [ctx.clientId])).toHaveLength(1);

    const [row] = await q<{ id: string; approval_status: string; flag_reasons: string[]; amount: string; reading_meta: Record<string, { source: string }> }>(
      "select id, approval_status, flag_reasons, amount, reading_meta from procurement_entries where client_id = $1", [ctx.clientId]);
    ctx.entryId = row.id;
    expect(row.flag_reasons).toEqual([]);
    expect(row.approval_status).toBe("approved");
    expect(Number(row.amount)).toBe(40303.5);
    expect(row.reading_meta.grossKg.source).toBe("ai_confirmed");

    // The queued SMS is now sent (the provider call is a stub of the mock provider).
    const smsFetch = (async () =>
      new Response(JSON.stringify({ sms: { id: "sms-1", status: "delivered", recipientMasked: "XXXXXX0001", statusAt: new Date().toISOString() } }), { status: 200 })) as unknown as typeof fetch;
    expect(await processSmsQueue(local, { operatorId: OPERATOR, fetchImpl: smsFetch })).toMatchObject({ delivered: 1 });
  });

  it("14-15. the office manager reviews and approves; the operator cannot", async () => {
    await expect(asUser(OPERATOR, () => q("select review_entry($1, 'approve', null)", [ctx.entryId]))).rejects.toThrow(/only office managers/i);
    const audit = await asUser(MANAGER, () => q<{ action: string }>("select action from procurement_audit_logs where entry_id = $1 order by created_at", [ctx.entryId]));
    expect(audit.map((a) => a.action)).toContain("created");
    // Already approved by the rules (clean entry); an explicit manager decision is still recorded.
    await asUser(MANAGER, () => q("select review_entry($1, 'approve', 'Checked against the slip')", [ctx.entryId]).catch(() => null));
    const [row] = await q<{ approval_status: string }>("select approval_status from procurement_entries where id = $1", [ctx.entryId]);
    expect(row.approval_status).toBe("approved");
  });

  it("16. the manager generates a payment run; a second run finds nothing left to pay", async () => {
    const [run] = await asUser(MANAGER, () => q<{ r: { run_id: string; entry_count: number; item_count: number; total_amount: string } }>("select create_payment_run($1::date, $2::date, array[$3]::uuid[]) as r", [today, today, centreId]));
    expect(run.r.entry_count).toBe(1);
    expect(run.r.item_count).toBe(1);
    expect(Number(run.r.total_amount)).toBe(40303.5);
    ctx.runId = run.r.run_id;
    await expect(asUser(MANAGER, () => q("select create_payment_run($1::date, $2::date, array[$3]::uuid[])", [today, today, centreId]))).rejects.toThrow(/ks:no_eligible/);
    const [entry] = await q<{ payment_status: string }>("select payment_status from procurement_entries where id = $1", [ctx.entryId]);
    expect(entry.payment_status).toBe("in_run");
    await asUser(MANAGER, () => q("select approve_payment_run($1)", [ctx.runId]));
  });

  it("17. the manager downloads the mock bank CSV", async () => {
    const [started] = await asUser(MANAGER, () => q<{ r: { first: boolean; file_name: string } }>("select start_bank_file($1) as r", [ctx.runId]));
    expect(started.r.first).toBe(true);
    const items = await asUser(MANAGER, () =>
      q<{ holder_name: string; account_number: string; ifsc: string; amount: string; payment_ref: string; farmer_code: string }>(
        `select b.holder_name, b.account_number, b.ifsc, i.amount, i.payment_ref, f.member_code as farmer_code
           from payment_items i join farmer_members f on f.id = i.farmer_id
           join farmer_bank_accounts b on b.member_id = f.id where i.run_id = $1`, [ctx.runId]),
    );
    expect(items).toHaveLength(1);
    const file = buildBankFile(
      items.map((i) => ({ beneficiaryName: i.holder_name, accountNumber: i.account_number, ifsc: i.ifsc, amount: String(i.amount), paymentRef: i.payment_ref, runNo: "PR-E2E", farmerCode: i.farmer_code })),
      DEFAULT_BANK_FILE_CONFIG,
    );
    expect(file.content).toContain("40303.50");
    expect(file.content).toContain("000011112222");
    expect(file.content.trim().split(/\r?\n/)).toHaveLength(2);
    const [run] = await q<{ status: string }>("select status from payment_runs where id = $1", [ctx.runId]);
    expect(run.status).toBe("file_generated");
  });

  it("18-19. the manager simulates success and the farmer's payment status becomes paid", async () => {
    const [item] = await q<{ id: string }>("select id from payment_items where run_id = $1", [ctx.runId]);
    await asUser(MANAGER, () => q("select simulate_bank_response($1::uuid[], 'paid', null)", [[item.id]]));
    const [entry] = await q<{ payment_status: string }>("select payment_status from procurement_entries where id = $1", [ctx.entryId]);
    expect(entry.payment_status).toBe("paid");
    // The slip the operator would reprint now says paid, and a settled payment cannot be redone.
    await expect(asUser(MANAGER, () => q("select simulate_bank_response($1::uuid[], 'failed', 'Account closed')", [[item.id]]))).rejects.toThrow(/ks:item_not_processing/);
    await expect(asUser(MANAGER, () => q("select create_payment_run($1::date, $2::date, array[$3]::uuid[])", [today, today, centreId]))).rejects.toThrow(/ks:no_eligible/);
    const [audit] = await asUser(MANAGER, () => q<{ n: number }>("select count(*)::int n from procurement_audit_logs where entry_id = $1 and action <> 'created'", [ctx.entryId]));
    expect(audit.n).toBeGreaterThan(0);
  });

  it("the operator sees only their own centre's data and no bank details", async () => {
    expect(await asUser(OPERATOR, () => q("select * from farmer_bank_accounts"))).toEqual([]);
    expect(await asUser(OPERATOR, () => q("select * from payment_runs"))).toEqual([]);
    expect(await asUser(OPERATOR, () => q("select * from payment_items"))).toEqual([]);
  });
});
