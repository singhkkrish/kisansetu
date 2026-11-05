import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findChainBreak, verifyPayloadHash } from "@/lib/offline/integrity";
import type { EntryRecord } from "@/lib/validation/procurement";

/** The sample-data scripts must produce entries the app itself would accept: valid hashes, an unbroken chain, and a payable mix. */

const SUPABASE_DIR = path.resolve(import.meta.dirname, "../../supabase");
const MANAGER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OP07 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OP12 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create schema auth;
    create table auth.users (id uuid primary key, email text, raw_app_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
    create role authenticated;
    create role anon;
  `);
  for (const file of fs.readdirSync(path.join(SUPABASE_DIR, "migrations")).sort()) {
    await db.exec(fs.readFileSync(path.join(SUPABASE_DIR, "migrations", file), "utf8"));
  }
  await db.exec(fs.readFileSync(path.join(SUPABASE_DIR, "seed.sql"), "utf8"));
  await db.exec(`
    insert into auth.users (id, email) values ('${MANAGER}', 'm@x.test'), ('${OP07}', 'a@x.test'), ('${OP12}', 'b@x.test');
    insert into profiles (id, full_name, role, centre_id, active) values
      ('${MANAGER}', 'Office Manager', 'office_manager', null, true),
      ('${OP07}', 'Op 7', 'centre_operator', (select id from centres where code = 'C07'), true),
      ('${OP12}', 'Op 12', 'centre_operator', (select id from centres where code = 'C12'), true);
  `);
  await db.exec(fs.readFileSync(path.join(SUPABASE_DIR, "seed_procurement.sql"), "utf8"));
  await db.exec(fs.readFileSync(path.join(SUPABASE_DIR, "seed_stock.sql"), "utf8"));
}, 60_000);

afterAll(async () => {
  await db.close();
});

interface Row {
  id: string; client_id: string; slip_no: string; farmer_id: string; centre_id: string; operator_id: string;
  crop: "soybean" | "tur"; grade: "A" | "B" | "C"; gross_kg: string; tare_kg: string; moisture_pct: string; net_kg: string;
  rate_per_quintal: string; amount: string; device_id: string; device_recorded_at: Date; payload_hash: string;
  prev_hash: string | null; device_clock_offset_ms: number | null; approval_status: string; flag_reasons: string[];
}

const toRecord = (r: Row): EntryRecord => ({
  clientId: r.client_id, slipNo: r.slip_no, farmerId: r.farmer_id, centreId: r.centre_id, operatorId: r.operator_id,
  crop: r.crop, grade: r.grade, grossKg: Number(r.gross_kg).toFixed(1), tareKg: Number(r.tare_kg).toFixed(1),
  moisturePct: Number(r.moisture_pct).toFixed(1), netKg: Number(r.net_kg).toFixed(1),
  ratePerQuintal: Number(r.rate_per_quintal).toFixed(2), amount: Number(r.amount).toFixed(2),
  deviceId: r.device_id, deviceRecordedAt: r.device_recorded_at.toISOString(), prevHash: r.prev_hash,
  clockOffsetMs: r.device_clock_offset_ms, payloadHash: r.payload_hash,
}) as EntryRecord;

describe("sample data for the payment and stock demos", () => {
  it("creates entries whose hashes verify and whose device chains are unbroken", async () => {
    const { rows } = await db.query<Row>("select * from procurement_entries order by device_id, device_recorded_at");
    expect(rows.length).toBeGreaterThanOrEqual(20);
    for (const r of rows) expect(await verifyPayloadHash(toRecord(r)), r.slip_no).toBe(true);
    for (const device of new Set(rows.map((r) => r.device_id))) {
      const chain = rows.filter((r) => r.device_id === device).map(toRecord);
      expect(findChainBreak(chain, null), device).toBe(-1);
    }
  });

  it("gives the payment run something to group, and one entry held for review", async () => {
    const approved = await db.query<{ n: number; farmers: number }>(
      "select count(*)::int n, count(distinct farmer_id)::int farmers from procurement_entries where approval_status = 'approved' and payment_status = 'unpaid'");
    expect(approved.rows[0].n).toBeGreaterThan(10);
    expect(approved.rows[0].farmers).toBeGreaterThan(5);
    const held = await db.query<{ slip_no: string; flag_reasons: string[] }>(
      "select slip_no, flag_reasons from procurement_entries where approval_status = 'held'");
    expect(held.rows.map((r) => r.slip_no)).toContain("C07-24528");
    expect(held.rows.find((r) => r.slip_no === "C07-24528")?.flag_reasons).toContain("rate_mismatch");
  });

  it("includes a farmer whose unverified bank account blocks payment", async () => {
    const { rows } = await db.query<{ n: number }>(
      `select count(*)::int n from procurement_entries e join farmer_bank_accounts b on b.member_id = e.farmer_id
        where not b.verified`);
    expect(rows[0].n).toBeGreaterThan(0);
  });

  it("is safe to run twice", async () => {
    const before = (await db.query<{ n: number }>("select count(*)::int n from procurement_entries")).rows[0].n;
    await db.exec(fs.readFileSync(path.join(SUPABASE_DIR, "seed_stock.sql"), "utf8"));
    expect((await db.query<{ n: number }>("select count(*)::int n from procurement_entries")).rows[0].n).toBe(before);
  });
});
