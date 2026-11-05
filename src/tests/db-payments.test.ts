import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Payment runs, simulated bank responses, dispatch and stock figures, tested
 * against the real migrations in an in-memory Postgres, acting as each role.
 */

const SUPABASE_DIR = path.resolve(import.meta.dirname, "../../supabase");
const MANAGER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OPERATOR_C07 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OPERATOR_C12 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

let db: PGlite;
let c07: string;
let c12: string;
let farmerA: string; // verified bank, centre C07
let farmerB: string; // verified bank, centre C07
let farmerNoBank: string; // unverified bank account
let farmerC12: string; // verified bank, centre C12
let slipSeq = 100;

async function asUser<T>(uid: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`select set_config('app.uid', '${uid}', false); set role authenticated;`);
  try {
    return await fn();
  } finally {
    await db.exec("reset role; select set_config('app.uid', '', false);");
  }
}

async function failsWith(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("expected the statement to fail");
}

/** Inserts a procurement entry the way the sync service would (the triggers decide its state). */
async function addEntry(o: {
  farmer: string;
  centre: string;
  operator: string;
  crop?: "soybean" | "tur";
  net?: number;
  rate?: number;
  at?: string;
}): Promise<string> {
  const crop = o.crop ?? "soybean";
  const net = o.net ?? 1000;
  const rate = o.rate ?? (crop === "soybean" ? 4850 : 7200);
  const centreCode = o.centre === c07 ? "C07" : "C12";
  const slip = `${centreCode}-${String(++slipSeq).padStart(5, "0")}`;
  const amount = (Math.round(net * rate) / 100).toFixed(2);
  const { rows } = await db.query<{ id: string }>(
    `insert into procurement_entries
       (client_id, slip_no, farmer_id, centre_id, operator_id, crop, grade, gross_kg, tare_kg, moisture_pct,
        net_kg, rate_per_quintal, amount, device_id, device_recorded_at, payload_hash)
     values (gen_random_uuid(), $1, $2, $3, $4, $5, 'A', $6, 0, 10, $6, $7, $8, 'dev-pay-test', $9, repeat('a', 64))
     returning id`,
    [slip, o.farmer, o.centre, o.operator, crop, net, rate, amount, o.at ?? "2026-11-02T06:00:00Z"],
  );
  return rows[0].id;
}

const run = (from: string, to: string, centres: string[]) =>
  asUser(MANAGER, async () =>
    (await db.query<{ r: Record<string, unknown> }>(
      "select create_payment_run($1::date, $2::date, $3::uuid[]) as r", [from, to, centres])).rows[0].r);

const entryRow = async (id: string) =>
  (await db.query<{ payment_status: string; approval_status: string }>(
    "select payment_status, approval_status from procurement_entries where id = $1", [id])).rows[0];

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create schema auth;
    create table auth.users (id uuid primary key, email text, raw_app_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
    create role authenticated;
    create role anon;
    grant usage on schema auth to authenticated, anon;
  `);
  for (const file of fs.readdirSync(path.join(SUPABASE_DIR, "migrations")).sort()) {
    await db.exec(fs.readFileSync(path.join(SUPABASE_DIR, "migrations", file), "utf8"));
  }
  await db.exec(fs.readFileSync(path.join(SUPABASE_DIR, "seed.sql"), "utf8"));
  await db.exec(`
    grant usage on schema public to authenticated, anon;
    grant all on all tables in schema public to authenticated, anon;
    grant all on all sequences in schema public to authenticated;
    grant execute on all functions in schema public to authenticated;
  `);

  c07 = (await db.query<{ id: string }>("select id from centres where code = 'C07'")).rows[0].id;
  c12 = (await db.query<{ id: string }>("select id from centres where code = 'C12'")).rows[0].id;
  await db.exec(`
    insert into auth.users (id, email) values
      ('${MANAGER}', 'm@example.test'), ('${OPERATOR_C07}', 'o7@example.test'), ('${OPERATOR_C12}', 'o12@example.test');
    insert into profiles (id, full_name, role, centre_id, active) values
      ('${MANAGER}', 'Office Manager', 'office_manager', null, true),
      ('${OPERATOR_C07}', 'Operator Ganjur', 'centre_operator', '${c07}', true),
      ('${OPERATOR_C12}', 'Operator Murud', 'centre_operator', '${c12}', true);
    insert into daily_prices (price_date, crop, grade, rate_per_quintal) values
      ('2026-11-02', 'soybean', 'A', 4850), ('2026-11-02', 'tur', 'A', 7200),
      ('2026-11-03', 'soybean', 'A', 4850), ('2026-11-03', 'tur', 'A', 7200),
      ('2026-11-04', 'soybean', 'A', 4850)
    on conflict do nothing;
  `);

  const pick = async (where: string) =>
    (await db.query<{ id: string }>(
      `select m.id from farmer_members m join farmer_bank_accounts b on b.member_id = m.id
        where ${where} order by m.member_code`)).rows.map((r) => r.id);
  [farmerA, farmerB] = await pick(`b.verified and m.centre_id = '${c07}'`);
  [farmerNoBank] = await pick("not b.verified");
  [farmerC12] = await pick(`b.verified and m.centre_id = '${c12}'`);
}, 60_000);

afterAll(async () => {
  await db.close();
});

describe("payment run generation", () => {
  it("groups approved unpaid entries by farmer and totals them exactly", async () => {
    const e1 = await addEntry({ farmer: farmerA, centre: c07, operator: OPERATOR_C07, net: 1000 });
    const e2 = await addEntry({ farmer: farmerA, centre: c07, operator: OPERATOR_C07, net: 250 });
    const e3 = await addEntry({ farmer: farmerB, centre: c07, operator: OPERATOR_C07, crop: "tur", net: 400 });

    const result = await run("2026-11-02", "2026-11-02", [c07]);
    expect(result.item_count).toBe(2);
    expect(result.entry_count).toBe(3);
    // 1000kg*4850/100 = 48500, 250kg = 12125, 400kg*7200/100 = 28800
    expect(Number(result.total_amount)).toBe(48500 + 12125 + 28800);
    expect(result.run_no).toMatch(/^PR-\d{8}-001$/);

    const { rows } = await db.query<{ farmer_id: string; entry_count: number; amount: string; payment_ref: string; status: string }>(
      "select farmer_id, entry_count, amount, payment_ref, status from payment_items where run_id = $1 order by amount desc", [result.run_id]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ farmer_id: farmerA, entry_count: 2, status: "pending" });
    expect(Number(rows[0].amount)).toBe(60625);
    expect(Number(rows[1].amount)).toBe(28800);
    expect(new Set(rows.map((r) => r.payment_ref)).size).toBe(2);

    for (const id of [e1, e2, e3]) expect((await entryRow(id)).payment_status).toBe("in_run");
    const sums = await db.query<{ s: string }>("select sum(amount)::text s from payment_run_entries");
    expect(Number(sums.rows[0].s)).toBe(Number(result.total_amount));
  });

  it("refuses to pay the same entries twice", async () => {
    const message = await failsWith(run("2026-11-02", "2026-11-02", [c07]));
    expect(message).toContain("ks:no_eligible_entries");
    const { rows } = await db.query<{ n: number }>("select count(*)::int n from payment_runs");
    expect(rows[0].n).toBe(1); // the failed attempt left no empty run behind
  });

  it("has a database-level stop against a second active link for an entry", async () => {
    const { rows } = await db.query<{ item_id: string; entry_id: string }>("select item_id, entry_id from payment_run_entries limit 1");
    const message = await failsWith(
      db.query("insert into payment_run_entries (item_id, entry_id, amount) select id, $2, 1 from payment_items where id <> $1 limit 1",
        [rows[0].item_id, rows[0].entry_id]));
    expect(message).toMatch(/unique|duplicate/i);
  });

  it("only takes approved entries inside the dates and centres chosen", async () => {
    const inRange = await addEntry({ farmer: farmerB, centre: c07, operator: OPERATOR_C07, at: "2026-11-03T06:00:00Z" });
    const otherDay = await addEntry({ farmer: farmerB, centre: c07, operator: OPERATOR_C07, at: "2026-11-04T06:00:00Z" });
    const otherCentre = await addEntry({ farmer: farmerC12, centre: c12, operator: OPERATOR_C12, at: "2026-11-03T06:00:00Z" });
    // Wrong rate: the server holds it for review, so it is not payable until a manager approves.
    const held = await addEntry({ farmer: farmerB, centre: c07, operator: OPERATOR_C07, rate: 5000, at: "2026-11-03T07:00:00Z" });
    expect((await entryRow(held)).approval_status).toBe("held");

    const result = await run("2026-11-03", "2026-11-03", [c07]);
    expect(result.entry_count).toBe(1);
    expect((await entryRow(inRange)).payment_status).toBe("in_run");
    for (const id of [otherDay, otherCentre, held]) expect((await entryRow(id)).payment_status).toBe("unpaid");
  });

  it("leaves out farmers without a verified bank account and reports them", async () => {
    const skipped = await addEntry({ farmer: farmerNoBank, centre: c07, operator: OPERATOR_C07, at: "2026-11-02T08:00:00Z" });
    const paid = await addEntry({ farmer: farmerB, centre: c07, operator: OPERATOR_C07, at: "2026-11-02T08:30:00Z", net: 100 });
    const result = await run("2026-11-02", "2026-11-02", [c07]);
    expect(result.entry_count).toBe(1);
    expect(result.skipped_entries).toBe(1);
    expect(Number(result.skipped_amount)).toBe(48500);
    expect((await entryRow(skipped)).payment_status).toBe("unpaid");
    expect((await entryRow(paid)).payment_status).toBe("in_run");
  });

  it("validates the selection", async () => {
    expect(await failsWith(run("2026-11-05", "2026-11-02", [c07]))).toContain("ks:bad_range");
    expect(await failsWith(run("2026-11-02", "2026-11-02", []))).toContain("ks:no_centres");
    expect(await failsWith(run("2020-01-01", "2026-11-02", [c07]))).toContain("ks:range_too_long");
  });
});

describe("payment authorization", () => {
  it("refuses operators every payment function and hides payment data", async () => {
    for (const sql of [
      `select create_payment_run('2026-11-02', '2026-11-02', array['${c07}']::uuid[])`,
      "select approve_payment_run(gen_random_uuid())",
      "select start_bank_file(gen_random_uuid())",
      "select simulate_bank_response(array[gen_random_uuid()], 'paid', null)",
      "select cancel_payment_run(gen_random_uuid(), 'no longer needed')",
      "select release_failed_item(gen_random_uuid())",
      `select record_dispatch('${c07}', 'soybean', 10, 10, 'Latur', 'MH24AB1234', null)`,
      "select * from stock_summary(null, null, null)",
    ]) {
      expect(await asUser(OPERATOR_C07, () => failsWith(db.query(sql))), sql).toMatch(/only office managers/i);
    }
    for (const table of ["payment_runs", "payment_items", "payment_run_entries", "payment_audit_logs", "stock_dispatches"]) {
      const rows = await asUser(OPERATOR_C07, async () => (await db.query(`select * from ${table}`)).rows);
      expect(rows, table).toEqual([]);
    }
  });

  it("refuses direct writes to payment tables, even by a manager", async () => {
    const id = (await db.query<{ id: string }>("select id from payment_items limit 1")).rows[0].id;
    const updated = await asUser(MANAGER, async () => (await db.query("update payment_items set status = 'paid' where id = $1 returning id", [id])).rows);
    expect(updated).toEqual([]);
    const message = await asUser(MANAGER, () =>
      failsWith(db.query("insert into payment_runs (run_no, date_from, date_to, centre_ids, created_by) values ('PR-20261101-999', '2026-11-01', '2026-11-01', array[gen_random_uuid()], $1)", [MANAGER])));
    expect(message).toMatch(/row-level security/i);
  });

  it("refuses a manager changing an entry's payment status directly", async () => {
    const { rows } = await db.query<{ id: string }>("select entry_id as id from payment_run_entries limit 1");
    const message = await asUser(MANAGER, () =>
      failsWith(db.query("update procurement_entries set payment_status = 'paid' where id = $1", [rows[0].id])));
    expect(message).toMatch(/payment run workflow/i);
    const free = await addEntry({ farmer: farmerA, centre: c07, operator: OPERATOR_C07, at: "2026-11-02T09:00:00Z" });
    const m2 = await asUser(MANAGER, () =>
      failsWith(db.query("update procurement_entries set payment_status = 'paid' where id = $1", [free])));
    expect(m2).toMatch(/payment run workflow/i);
  });
});

describe("approval, bank file and simulated responses", () => {
  let runId: string;
  let items: { id: string; farmer_id: string }[];

  beforeAll(async () => {
    const a = await addEntry({ farmer: farmerA, centre: c07, operator: OPERATOR_C07, at: "2026-11-03T05:00:00Z", net: 500 });
    const b = await addEntry({ farmer: farmerB, centre: c07, operator: OPERATOR_C07, at: "2026-11-03T05:10:00Z", net: 300 });
    void a; void b;
    const result = await run("2026-11-03", "2026-11-03", [c07]);
    runId = result.run_id as string;
    items = (await db.query<{ id: string; farmer_id: string }>("select id, farmer_id from payment_items where run_id = $1 order by farmer_code", [runId])).rows;
  });

  const status = async () => (await db.query<{ status: string }>("select status from payment_runs where id = $1", [runId])).rows[0].status;
  const itemStatus = async (id: string) => (await db.query<{ status: string }>("select status from payment_items where id = $1", [id])).rows[0].status;

  it("will not give out the bank file before the run is approved", async () => {
    expect(await asUser(MANAGER, () => failsWith(db.query("select start_bank_file($1)", [runId])))).toContain("ks:not_approved");
  });

  it("approves once, then moves items to processing when the file is generated", async () => {
    await asUser(MANAGER, () => db.query("select approve_payment_run($1)", [runId]));
    expect(await status()).toBe("approved");
    expect(await asUser(MANAGER, () => failsWith(db.query("select approve_payment_run($1)", [runId])))).toContain("ks:bad_state");

    const first = await asUser(MANAGER, async () => (await db.query<{ r: { first: boolean; file_name: string } }>("select start_bank_file($1) as r", [runId])).rows[0].r);
    expect(first.first).toBe(true);
    expect(first.file_name).toMatch(/^KISANSETU-MOCK-PR-/);
    expect(await status()).toBe("file_generated");
    expect(await itemStatus(items[0].id)).toBe("processing");

    const again = await asUser(MANAGER, async () => (await db.query<{ r: { first: boolean } }>("select start_bank_file($1) as r", [runId])).rows[0].r);
    expect(again.first).toBe(false);
    const log = await db.query<{ action: string }>("select action from payment_audit_logs where run_id = $1 order by created_at, id", [runId]);
    expect(log.rows.map((r) => r.action)).toEqual(expect.arrayContaining(["created", "approved", "file_generated", "file_downloaded"]));
  });

  it("cannot be cancelled once the file has gone to the bank", async () => {
    expect(await asUser(MANAGER, () => failsWith(db.query("select cancel_payment_run($1, 'changed my mind')", [runId])))).toContain("ks:bad_state");
  });

  it("keeps a failed payment visible with its reason and its entries marked failed", async () => {
    expect(await asUser(MANAGER, () => failsWith(db.query("select simulate_bank_response($1::uuid[], 'failed', null)", [[items[0].id]])))).toContain("ks:reason_required");
    await asUser(MANAGER, () => db.query("select simulate_bank_response($1::uuid[], 'failed', 'Account closed')", [[items[0].id]]));

    const failed = (await db.query<{ status: string; failure_reason: string }>("select status, failure_reason from payment_items where id = $1", [items[0].id])).rows[0];
    expect(failed).toEqual({ status: "failed", failure_reason: "Account closed" });
    const entries = await db.query<{ payment_status: string }>(
      "select e.payment_status from payment_run_entries r join procurement_entries e on e.id = r.entry_id where r.item_id = $1", [items[0].id]);
    expect(entries.rows.every((r) => r.payment_status === "failed")).toBe(true);
    expect(await status()).toBe("file_generated"); // the other item is still processing

    // A settled outcome cannot be flipped.
    expect(await asUser(MANAGER, () => failsWith(db.query("select simulate_bank_response($1::uuid[], 'paid', null)", [[items[0].id]])))).toContain("ks:item_not_processing");
  });

  it("marks entries paid, gives a bank reference, and completes the run when nothing is pending", async () => {
    await asUser(MANAGER, () => db.query("select simulate_bank_response($1::uuid[], 'paid', null)", [[items[1].id]]));
    const paid = (await db.query<{ status: string; bank_reference: string }>("select status, bank_reference from payment_items where id = $1", [items[1].id])).rows[0];
    expect(paid.status).toBe("paid");
    expect(paid.bank_reference).toMatch(/^MOCKUTR/);
    expect(await status()).toBe("completed");
    const entries = await db.query<{ payment_status: string }>(
      "select e.payment_status from payment_run_entries r join procurement_entries e on e.id = r.entry_id where r.item_id = $1", [items[1].id]);
    expect(entries.rows.every((r) => r.payment_status === "paid")).toBe(true);
  });

  it("returns a failed payment's entries to unpaid so they can be paid again, keeping the failed record", async () => {
    await asUser(MANAGER, () => db.query("select release_failed_item($1)", [items[0].id]));
    const item = (await db.query<{ status: string; released_at: string | null }>("select status, released_at from payment_items where id = $1", [items[0].id])).rows[0];
    expect(item.status).toBe("failed");
    expect(item.released_at).not.toBeNull();
    expect(await asUser(MANAGER, () => failsWith(db.query("select release_failed_item($1)", [items[0].id])))).toContain("ks:bad_state");

    const again = await run("2026-11-03", "2026-11-03", [c07]);
    expect(again.entry_count).toBe(1);
    expect(again.run_no).toMatch(/-00[2-9]$/);
  });

  it("refuses to change a payment item's amount or bank details", async () => {
    const message = await failsWith(db.query("update payment_items set amount = 1 where id = $1", [items[1].id]));
    expect(message).toMatch(/fixed once/i);
    const m2 = await failsWith(db.query("update payment_items set status = 'failed', failure_reason = 'x' where id = $1", [items[1].id]));
    expect(m2).toMatch(/cannot change its outcome/i);
  });
});

describe("cancelling a run before payment", () => {
  it("returns its entries to unpaid and needs a reason", async () => {
    const id = await addEntry({ farmer: farmerA, centre: c07, operator: OPERATOR_C07, at: "2026-11-04T05:00:00Z", net: 200 });
    const result = await run("2026-11-04", "2026-11-04", [c07]);
    expect((await entryRow(id)).payment_status).toBe("in_run");

    expect(await asUser(MANAGER, () => failsWith(db.query("select cancel_payment_run($1, 'x')", [result.run_id])))).toContain("ks:reason_required");
    await asUser(MANAGER, () => db.query("select cancel_payment_run($1, 'Wrong date range chosen')", [result.run_id]));
    expect((await entryRow(id)).payment_status).toBe("unpaid");

    // The earlier "other day" entry shares this date, so the re-run picks up both.
    const again = await run("2026-11-04", "2026-11-04", [c07]);
    expect(again.entry_count).toBe(2);
  });
});

describe("stock and dispatch", () => {
  it("computes stock per centre and crop, excluding rejected purchases", async () => {
    const before = await asUser(MANAGER, async () =>
      (await db.query<{ procured_kg: string }>("select procured_kg from stock_summary('2026-11-30', $1, 'tur')", [c12])).rows[0]);
    const base = Number(before.procured_kg);
    await addEntry({ farmer: farmerC12, centre: c12, operator: OPERATOR_C12, crop: "tur", net: 640, at: "2026-11-02T06:00:00Z" });
    const rejected = await addEntry({ farmer: farmerC12, centre: c12, operator: OPERATOR_C12, crop: "tur", net: 99, at: "2026-11-02T06:10:00Z" });
    await asUser(MANAGER, () => db.query("select review_entry($1, 'reject', 'Duplicate slip found')", [rejected]));

    const after = await asUser(MANAGER, async () =>
      (await db.query<{ procured_kg: string; day_kg: string }>("select procured_kg, day_kg from stock_summary('2026-11-02', $1, 'tur')", [c12])).rows[0]);
    expect(Number(after.procured_kg) - base).toBe(640);
    expect(Number(after.day_kg)).toBeGreaterThanOrEqual(640);
  });

  it("records a dispatch with stock before and after, and tracks the weight loss", async () => {
    const stock = async () => Number((await db.query<{ s: string }>("select stock_balance_kg($1, 'tur') s", [c12])).rows[0].s);
    const before = await stock();
    const r = await asUser(MANAGER, async () =>
      (await db.query<{ r: { stock_before_kg: string; stock_after_kg: string; dispatch_no: string } }>(
        "select record_dispatch($1, 'tur', 395.0, 400.0, 'Latur APMC', 'mh 24 ab-1234', null) as r", [c12])).rows[0].r);
    expect(Number(r.stock_before_kg)).toBe(before);
    expect(Number(r.stock_after_kg)).toBe(before - 400);
    expect(await stock()).toBe(before - 400);
    expect(r.dispatch_no).toMatch(/^DS-\d{8}-001$/);

    const row = (await db.query<{ truck_no: string; weight_kg: string; book_kg: string }>("select truck_no, weight_kg, book_kg from stock_dispatches")).rows[0];
    expect(row.truck_no).toBe("MH24AB1234");
    expect(Number(row.book_kg) - Number(row.weight_kg)).toBe(5);
  });

  it("refuses dispatching more than the stock, a weight above the book, and bad details", async () => {
    const call = (args: string) => asUser(MANAGER, () => failsWith(db.query(`select record_dispatch(${args})`)));
    expect(await call(`'${c12}', 'tur', 90000, 90000, 'Latur', 'MH24AB1234', null`)).toContain("ks:insufficient_stock");
    expect(await call(`'${c12}', 'tur', 101, 100, 'Latur', 'MH24AB1234', null`)).toContain("ks:weight_above_book");
    expect(await call(`'${c12}', 'tur', 10, 10, 'L', 'MH24AB1234', null`)).toContain("ks:bad_details");
    expect(await call(`'${c12}', 'tur', 10, 10, 'Latur', 'X1', null`)).toContain("ks:bad_details");
    expect(await call(`'${c12}', 'tur', 0, 10, 'Latur', 'MH24AB1234', null`)).toContain("ks:bad_weight");
    expect(await call(`'${c12}', 'tur', 10, 10, 'Latur', 'MH24AB1234', now() + interval '1 day'`)).toContain("ks:bad_time");
  });

  it("never allows a dispatch record to be edited or deleted", async () => {
    expect(await failsWith(db.query("update stock_dispatches set weight_kg = 1"))).toMatch(/cannot be changed/i);
    expect(await failsWith(db.query("delete from stock_dispatches"))).toMatch(/cannot be changed/i);
  });

  it("subtracts dispatches from the summary and reports weight actually dispatched", async () => {
    const row = await asUser(MANAGER, async () =>
      (await db.query<{ procured_kg: string; dispatched_book_kg: string; dispatched_weight_kg: string }>(
        "select procured_kg, dispatched_book_kg, dispatched_weight_kg from stock_summary(null, $1, 'tur')", [c12])).rows[0]);
    expect(Number(row.dispatched_book_kg)).toBe(400);
    expect(Number(row.dispatched_weight_kg)).toBe(395);
  });

  it("counts failed and pending payments and unsynced records", async () => {
    const rows = await asUser(MANAGER, async () => (await db.query<{ failed_count: number; pending_pay_count: number }>(
      "select failed_count, pending_pay_count from stock_summary(null, null, null)")).rows);
    expect(rows.reduce((n, r) => n + r.pending_pay_count, 0)).toBeGreaterThan(0);
    const unsynced = await asUser(MANAGER, async () => (await db.query<{ n: number }>("select unsynced_records(null) n")).rows[0].n);
    expect(unsynced).toBe(0);
  });
});
