import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findChainBreak, verifyPayloadHash } from "@/lib/offline/integrity";
import type { EntryRecord } from "@/lib/validation/procurement";

/**
 * Runs the real migrations and seed in an in-memory Postgres and then acts as
 * each kind of user, so row level security and the write functions are tested
 * as they will behave in Supabase. Only `auth.users` and `auth.uid()` are stubbed.
 */

const SUPABASE_DIR = path.resolve(import.meta.dirname, "../../supabase");

const MANAGER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OPERATOR_C07 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OPERATOR_C12 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const INACTIVE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

let db: PGlite;
let centreC07: string;
let centreC12: string;

/** Runs `fn` as the given user (or as an anonymous caller when null). */
async function asUser<T>(uid: string | null, fn: () => Promise<T>): Promise<T> {
  await db.exec(`select set_config('app.uid', '${uid ?? ""}', false); set role ${uid ? "authenticated" : "anon"};`);
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

  centreC07 = (await db.query<{ id: string }>("select id from centres where code = 'C07'")).rows[0].id;
  centreC12 = (await db.query<{ id: string }>("select id from centres where code = 'C12'")).rows[0].id;

  await db.exec(`
    insert into auth.users (id, email) values
      ('${MANAGER}', 'manager@example.test'), ('${OPERATOR_C07}', 'op07@example.test'),
      ('${OPERATOR_C12}', 'op12@example.test'), ('${INACTIVE}', 'gone@example.test');
    insert into profiles (id, full_name, role, centre_id, active) values
      ('${MANAGER}', 'Office Manager', 'office_manager', null, true),
      ('${OPERATOR_C07}', 'Operator Ganjur', 'centre_operator', '${centreC07}', true),
      ('${OPERATOR_C12}', 'Operator Murud', 'centre_operator', '${centreC12}', true),
      ('${INACTIVE}', 'Former Operator', 'centre_operator', '${centreC07}', false);
  `);
}, 60_000);

afterAll(async () => {
  await db.close();
});

describe("seed data", () => {
  it("has at least 30 farmers across several villages and centres", async () => {
    const { rows } = await db.query<{ farmers: number; villages: number; centres: number }>(`
      select count(*)::int as farmers, count(distinct village)::int as villages,
             count(distinct centre_id)::int as centres from farmer_members`);
    expect(rows[0].farmers).toBeGreaterThanOrEqual(30);
    expect(rows[0].villages).toBeGreaterThanOrEqual(8);
    expect(rows[0].centres).toBeGreaterThanOrEqual(6);
  });

  it("includes active and inactive farmers and verified and unverified accounts", async () => {
    const { rows } = await db.query<{ k: string; n: number }>(`
      select 'inactive' as k, count(*)::int n from farmer_members where not active
      union all select 'unverified', count(*)::int from farmer_bank_accounts where not verified
      union all select 'verified', count(*)::int from farmer_bank_accounts where verified
      union all select 'no_bank', count(*)::int from farmer_members m
        where not exists (select 1 from farmer_bank_accounts b where b.member_id = m.id)`);
    for (const row of rows) expect(row.n, row.k).toBeGreaterThan(0);
  });

  it("has no column that could hold an Aadhaar number", async () => {
    const { rows } = await db.query(`
      select column_name from information_schema.columns
       where table_schema = 'public' and column_name ilike any (array['%aadhaar%', '%aadhar%', '%uid%number%'])`);
    expect(rows).toEqual([]);
  });

  it("mirrors the bank status onto farmer_members", async () => {
    const { rows } = await db.query<{ n: number }>(`
      select count(*)::int n from farmer_members m
        join farmer_bank_accounts b on b.member_id = m.id where m.bank_verified <> b.verified`);
    expect(rows[0].n).toBe(0);
  });
});

describe("farmer_members access", () => {
  it("lets a centre operator search every member", async () => {
    const count = await asUser(OPERATOR_C07, async () =>
      (await db.query<{ n: number }>("select count(*)::int n from farmer_members")).rows[0].n);
    expect(count).toBeGreaterThanOrEqual(30);
  });

  it("stops a centre operator from editing members directly", async () => {
    const updated = await asUser(OPERATOR_C07, async () =>
      (await db.query("update farmer_members set village = 'Hacked' where member_code = 'FM00101' returning id")).rows);
    expect(updated).toEqual([]);

    const message = await asUser(OPERATOR_C07, () =>
      failsWith(db.query(`insert into farmer_members (member_code, full_name, village) values ('FM09999', 'X Y', 'Z')`)));
    expect(message).toMatch(/row-level security/i);
  });

  it("gives an anonymous caller nothing", async () => {
    const rows = await asUser(null, async () => (await db.query("select id from farmer_members")).rows);
    expect(rows).toEqual([]);
  });

  it("gives a deactivated staff member nothing", async () => {
    const rows = await asUser(INACTIVE, async () => (await db.query("select id from farmer_members")).rows);
    expect(rows).toEqual([]);
  });
});

describe("bank details", () => {
  it("are invisible to centre operators", async () => {
    const rows = await asUser(OPERATOR_C07, async () => (await db.query("select * from farmer_bank_accounts")).rows);
    expect(rows).toEqual([]);
  });

  it("cannot be written by centre operators", async () => {
    const message = await asUser(OPERATOR_C07, () =>
      failsWith(db.query(`insert into farmer_bank_accounts (member_id, holder_name, account_number, ifsc)
        select id, 'X Y', '123456789012', 'SBIN0001234' from farmer_members where member_code = 'FM00125'`)));
    expect(message).toMatch(/row-level security/i);
  });

  it("are readable by office managers", async () => {
    const count = await asUser(MANAGER, async () =>
      (await db.query<{ n: number }>("select count(*)::int n from farmer_bank_accounts")).rows[0].n);
    expect(count).toBeGreaterThanOrEqual(30);
  });

  it("still show operators the verified status through the member row", async () => {
    const row = await asUser(OPERATOR_C07, async () =>
      (await db.query<{ bank_verified: boolean }>("select bank_verified from farmer_members where member_code = 'FM00101'")).rows[0]);
    expect(row.bank_verified).toBe(true);
  });

  it("reject malformed IFSC codes and account numbers at the database", async () => {
    const badIfsc = await failsWith(db.query(`insert into farmer_bank_accounts (member_id, holder_name, account_number, ifsc)
      select id, 'X Y', '123456789012', 'sbin1234' from farmer_members where member_code = 'FM00125'`));
    expect(badIfsc).toMatch(/ifsc/i);
    const badAccount = await failsWith(db.query(`insert into farmer_bank_accounts (member_id, holder_name, account_number, ifsc)
      select id, 'X Y', '12AB', 'SBIN0001234' from farmer_members where member_code = 'FM00125'`));
    expect(badAccount).toMatch(/account_number/i);
  });
});

describe("register_farmer", () => {
  const payload = (centreId: string, extra: Record<string, unknown> = {}) =>
    JSON.stringify({
      full_name: "Datta Ranjane", village: "Murud", centre_id: centreId, phone: "9000000777",
      land_acres: "8.50", crops: ["soybean"], active: true,
      bank: { holder_name: "Datta Ranjane", account_number: "123456789012", ifsc: "sbin0001234" },
      ...extra,
    });

  it("is refused for centre operators and anonymous callers", async () => {
    const operator = await asUser(OPERATOR_C07, () =>
      failsWith(db.query("select register_farmer($1::jsonb)", [payload(centreC07)])));
    expect(operator).toMatch(/only office managers/i);
    const anon = await asUser(null, () =>
      failsWith(db.query("select register_farmer($1::jsonb)", [payload(centreC07)])));
    expect(anon).toMatch(/permission denied|only office managers/i);
  });

  it("creates the member, bank account and audit entry together with the next farmer ID", async () => {
    const result = await asUser(MANAGER, async () =>
      (await db.query<{ r: { id: string; member_code: string } }>("select register_farmer($1::jsonb) as r", [payload(centreC12)])).rows[0].r);

    expect(result.member_code).toBe("FM00204"); // seed's highest code is FM00203

    const member = (await db.query<{ crops: string[]; consent: boolean; ifsc: string; verified: boolean; bank_verified: boolean }>(`
      select m.crops::text[] as crops, m.consent_recorded_at is not null as consent, b.ifsc, b.verified, m.bank_verified
        from farmer_members m join farmer_bank_accounts b on b.member_id = m.id where m.id = $1`, [result.id])).rows[0];
    expect(member).toMatchObject({ crops: ["soybean"], consent: true, ifsc: "SBIN0001234", verified: false, bank_verified: false });

    const audit = await db.query("select action from member_audit_logs where member_id = $1", [result.id]);
    expect(audit.rows).toEqual([{ action: "registered" }]);
  });

  it("rejects invalid data and rolls the whole registration back", async () => {
    const before = (await db.query<{ n: number }>("select count(*)::int n from farmer_members")).rows[0].n;
    const message = await asUser(MANAGER, () =>
      failsWith(db.query("select register_farmer($1::jsonb)", [payload(centreC12, { bank: { holder_name: "X Y", account_number: "12", ifsc: "SBIN0001234" } })])));
    expect(message).toMatch(/account_number/i);
    const after = (await db.query<{ n: number }>("select count(*)::int n from farmer_members")).rows[0].n;
    expect(after).toBe(before);
  });
});

describe("update_farmer and bank verification", () => {
  async function memberId(code: string) {
    return (await db.query<{ id: string }>("select id from farmer_members where member_code = $1", [code])).rows[0].id;
  }
  const update = (extra: Record<string, unknown>) =>
    JSON.stringify({
      full_name: "Sunil Jadhav", village: "Ganjur", centre_id: centreC07, phone: "9000000101",
      land_acres: "14.50", crops: ["soybean", "tur"], active: true, ...extra,
    });

  it("is refused for centre operators", async () => {
    const id = await memberId("FM00101");
    const message = await asUser(OPERATOR_C07, () =>
      failsWith(db.query("select update_farmer($1, $2::jsonb)", [id, update({ village: "Elsewhere" })])));
    expect(message).toMatch(/only office managers/i);
  });

  it("records which fields changed, without copying bank values", async () => {
    const id = await memberId("FM00103");
    await asUser(MANAGER, () => db.query("select update_farmer($1, $2::jsonb)", [id, update({ full_name: "Ramesh Patil", village: "Ganjur", land_acres: "7.00" })]));
    const { rows } = await db.query<{ action: string; changed_fields: string[] }>(
      "select action, changed_fields from member_audit_logs where member_id = $1 order by created_at", [id]);
    expect(rows.at(-1)?.action).toBe("updated");
    expect(rows.at(-1)?.changed_fields).toEqual(expect.arrayContaining(["village", "land_acres"]));
  });

  it("keeps the stored account number when none is supplied", async () => {
    const id = await memberId("FM00102");
    const before = (await db.query<{ account_number: string }>("select account_number from farmer_bank_accounts where member_id = $1", [id])).rows[0];
    await asUser(MANAGER, () => db.query("select update_farmer($1, $2::jsonb)", [id,
      update({ full_name: "Kamal Shinde", bank: { holder_name: "Kamal Shinde", ifsc: "SBIN0012874" } })]));
    const after = (await db.query<{ account_number: string; verified: boolean }>("select account_number, verified from farmer_bank_accounts where member_id = $1", [id])).rows[0];
    expect(after.account_number).toBe(before.account_number);
    expect(after.verified).toBe(true); // nothing sensitive changed, so verification stands
  });

  it("clears verification when the account number changes", async () => {
    const id = await memberId("FM00105");
    await asUser(MANAGER, () => db.query("select update_farmer($1, $2::jsonb)", [id,
      update({ full_name: "Vitthal Deshmukh", bank: { holder_name: "Vitthal Deshmukh", account_number: "999988887777", ifsc: "HDFC0004021" } })]));
    const row = (await db.query<{ verified: boolean; bank_verified: boolean }>(
      "select b.verified, m.bank_verified from farmer_bank_accounts b join farmer_members m on m.id = b.member_id where b.member_id = $1", [id])).rows[0];
    expect(row).toEqual({ verified: false, bank_verified: false });
    const audit = await db.query("select 1 from member_audit_logs where member_id = $1 and action = 'bank_changed'", [id]);
    expect(audit.rows.length).toBe(1);
  });

  it("lets only a manager verify, and records who", async () => {
    const id = await memberId("FM00105");
    const denied = await asUser(OPERATOR_C07, () => failsWith(db.query("select verify_farmer_bank($1)", [id])));
    expect(denied).toMatch(/only office managers/i);

    await asUser(MANAGER, () => db.query("select verify_farmer_bank($1)", [id]));
    const row = (await db.query<{ verified: boolean; verified_by: string; bank_verified: boolean }>(
      "select b.verified, b.verified_by, m.bank_verified from farmer_bank_accounts b join farmer_members m on m.id = b.member_id where b.member_id = $1", [id])).rows[0];
    expect(row).toEqual({ verified: true, verified_by: MANAGER, bank_verified: true });
  });

  it("refuses to verify a farmer with no bank account", async () => {
    const id = await memberId("FM00125");
    const message = await asUser(MANAGER, () => failsWith(db.query("select verify_farmer_bank($1)", [id])));
    expect(message).toMatch(/no bank account/i);
  });

  it("refuses to add bank details without an account number", async () => {
    const id = await memberId("FM00125");
    const message = await asUser(MANAGER, () => failsWith(db.query("select update_farmer($1, $2::jsonb)", [id,
      update({ full_name: "Manohar Gutte", bank: { holder_name: "Manohar Gutte", ifsc: "SBIN0001234" } })])));
    expect(message).toMatch(/account number is required/i);
  });

  it("shows the audit log to managers only", async () => {
    const asOperator = await asUser(OPERATOR_C07, async () => (await db.query("select id from member_audit_logs")).rows);
    expect(asOperator).toEqual([]);
    const asManager = await asUser(MANAGER, async () => (await db.query("select id from member_audit_logs")).rows);
    expect(asManager.length).toBeGreaterThan(0);
  });
});

describe("centre scoping, prices and approvals", () => {
  async function insertEntry(slipNo: string, centreId: string, operatorId: string, memberCode: string) {
    await db.query(`
      insert into procurement_entries
        (client_id, slip_no, farmer_id, centre_id, operator_id, crop, grade, gross_kg, tare_kg, moisture_pct,
         net_kg, rate_per_quintal, amount, device_id, device_recorded_at, payload_hash)
      select gen_random_uuid(), $1, f.id, $2, $3, 'soybean', 'A', 860.0, 12.0, 14.0, 831.0, 4850, 40303.50,
             'dev-test-0001', now(), repeat('a', 64)
        from farmer_members f where f.member_code = $4`, [slipNo, centreId, operatorId, memberCode]);
  }

  beforeAll(async () => {
    await insertEntry("C07-00001", centreC07, OPERATOR_C07, "FM00101");
    await insertEntry("C12-00001", centreC12, OPERATOR_C12, "FM00203");
  });

  it("limits an operator to their own centre's procurement records", async () => {
    const slips = await asUser(OPERATOR_C07, async () =>
      (await db.query<{ slip_no: string }>("select slip_no from procurement_entries")).rows.map((r) => r.slip_no));
    expect(slips).toEqual(["C07-00001"]);
  });

  it("lets a manager see every centre", async () => {
    const slips = await asUser(MANAGER, async () =>
      (await db.query<{ slip_no: string }>("select slip_no from procurement_entries order by slip_no")).rows.map((r) => r.slip_no));
    expect(slips).toEqual(["C07-00001", "C12-00001"]);
  });

  it("stops an operator approving an entry", async () => {
    const rows = await asUser(OPERATOR_C07, async () =>
      (await db.query("update procurement_entries set approval_status = 'rejected' returning id")).rows);
    expect(rows).toEqual([]);
  });

  it("stops an operator recording an entry as someone else or for another centre", async () => {
    const message = await asUser(OPERATOR_C07, () => failsWith(insertEntry("C12-00002", centreC12, OPERATOR_C07, "FM00203")));
    expect(message).toMatch(/row-level security/i);
  });

  it("stops an operator changing daily prices", async () => {
    const updated = await asUser(OPERATOR_C07, async () =>
      (await db.query("update daily_prices set rate_per_quintal = 9999 returning id")).rows);
    expect(updated).toEqual([]);
    const message = await asUser(OPERATOR_C07, () =>
      failsWith(db.query("insert into daily_prices (price_date, crop, grade, rate_per_quintal) values (current_date + 1, 'tur', 'A', 7000)")));
    expect(message).toMatch(/row-level security/i);
  });

  it("lets a manager approve entries", async () => {
    const approved = await asUser(MANAGER, async () =>
      (await db.query("update procurement_entries set approval_status = 'approved' where slip_no = 'C07-00001' returning id")).rows);
    expect(approved).toHaveLength(1);
  });

  it("stops operators reading payment runs", async () => {
    const rows = await asUser(OPERATOR_C07, async () => (await db.query("select id from payment_runs")).rows);
    expect(rows).toEqual([]);
    const message = await asUser(OPERATOR_C07, () =>
      failsWith(db.query("insert into payment_runs (run_no, created_by) values ('RUN-1', $1)", [OPERATOR_C07])));
    expect(message).toMatch(/row-level security/i);
  });
});

describe("server-authoritative entry integrity", () => {
  beforeAll(async () => {
    // The seed prices "current_date" in the database's clock; entries are judged on the IST date.
    await db.exec(`insert into daily_prices (price_date, crop, grade, rate_per_quintal)
                   values (public.ist_today(), 'soybean', 'A', 4850) on conflict do nothing`);
  });

  async function insertAs(operatorId: string, centreId: string, slipNo: string, overrides: Record<string, string> = {}) {
    const v = {
      rate: "4850", at: "now()", offset: "null", approval: "'approved'", sync: "'pending'",
      payment: "'paid'", received: "'2001-01-01'", flags: "'{}'", ...overrides,
    };
    return asUser(operatorId, async () =>
      (await db.query<{ id: string }>(`
        insert into procurement_entries
          (client_id, slip_no, farmer_id, centre_id, operator_id, crop, grade, gross_kg, tare_kg, moisture_pct,
           net_kg, rate_per_quintal, amount, device_id, device_recorded_at, device_clock_offset_ms, payload_hash,
           approval_status, sync_status, payment_status, server_received_at, flag_reasons)
        select gen_random_uuid(), '${slipNo}', f.id, '${centreId}', '${operatorId}', 'soybean', 'A', 860.0, 12.0, 14.0,
               831.0, ${v.rate}, round(831.0 * ${v.rate} / 100, 2), 'dev-int-0001', ${v.at}, ${v.offset}, repeat('b', 64),
               ${v.approval}, ${v.sync}, ${v.payment}, ${v.received}, ${v.flags}
          from farmer_members f where f.member_code = 'FM00101' returning id`)).rows[0].id);
  }

  async function entry(id: string) {
    return (await db.query<Record<string, unknown>>("select * from procurement_entries where id = $1", [id])).rows[0];
  }

  it("ignores a client's claims about its own state and stamps the server time", async () => {
    const id = await insertAs(OPERATOR_C07, centreC07, "C07-00101");
    const row = await entry(id);
    expect(row.sync_status).toBe("synced");
    expect(row.payment_status).toBe("unpaid");
    expect(row.approval_status).toBe("approved");
    expect(new Date(row.server_received_at as string).getFullYear()).toBeGreaterThan(2001);
  });

  it("holds an entry whose rate differs from the published rate", async () => {
    const id = await insertAs(OPERATOR_C07, centreC07, "C07-00102", { rate: "5000" });
    const row = await entry(id);
    expect(row.approval_status).toBe("held");
    expect(row.flag_reasons).toContain("rate_mismatch");
  });

  it("holds an entry recorded on a day with no published price", async () => {
    const id = await insertAs(OPERATOR_C07, centreC07, "C07-00103", { at: "now() - interval '40 days'" });
    expect((await entry(id)).flag_reasons).toContain("no_price_for_day");
  });

  it("holds an entry from a clock running ahead of the server", async () => {
    const id = await insertAs(OPERATOR_C07, centreC07, "C07-00104", { at: "now() + interval '2 hours'" });
    const row = await entry(id);
    expect(row.flag_reasons).toContain("clock_ahead");
    expect(row.approval_status).toBe("held");
  });

  it("flags a large measured clock offset", async () => {
    const id = await insertAs(OPERATOR_C07, centreC07, "C07-00105", { offset: "3600000" });
    expect((await entry(id)).flag_reasons).toContain("clock_skew");
  });

  it("writes a created audit record with operator, centre and both timestamps", async () => {
    const id = await insertAs(OPERATOR_C07, centreC07, "C07-00106");
    const log = (await db.query<{ action: string; new_values: Record<string, unknown> }>(
      "select action, new_values from procurement_audit_logs where entry_id = $1", [id])).rows;
    expect(log).toHaveLength(1);
    expect(log[0].action).toBe("created");
    expect(log[0].new_values).toMatchObject({ created_by: OPERATOR_C07, centre_id: centreC07, sync_status: "synced" });
    expect(log[0].new_values.device_recorded_at).toBeTruthy();
    expect(log[0].new_values.server_received_at).toBeTruthy();
  });

  it("lets an operator read the audit trail of their own centre only", async () => {
    const own = await asUser(OPERATOR_C07, async () => (await db.query<{ slip_no: string }>(
      "select e.slip_no from procurement_audit_logs a join procurement_entries e on e.id = a.entry_id")).rows);
    expect(own.length).toBeGreaterThan(0);
    expect(own.every((r) => r.slip_no.startsWith("C07-"))).toBe(true);
  });

  it("refuses any change to the recorded purchase facts, even by a manager", async () => {
    const id = await insertAs(OPERATOR_C07, centreC07, "C07-00107");
    for (const set of ["gross_kg = 900.0", "server_received_at = now()", "device_clock_offset_ms = 5"]) {
      const message = await asUser(MANAGER, () => failsWith(db.query(`update procurement_entries set ${set} where id = '${id}'`)));
      expect(message).toMatch(/immutable|check/i);
    }
  });

  describe("review_entry", () => {
    it("lets a manager approve a held entry and records who did it", async () => {
      const id = await insertAs(OPERATOR_C07, centreC07, "C07-00108", { rate: "5000" });
      await asUser(MANAGER, () => db.query("select review_entry($1, 'approve', 'Rate confirmed by phone')", [id]));
      const row = await entry(id);
      expect(row.approval_status).toBe("approved");
      expect(row.review_note).toBe("Rate confirmed by phone");
      const log = (await db.query<{ actor_id: string; action: string }>(
        "select actor_id, action from procurement_audit_logs where entry_id = $1 and action = 'status_changed'", [id])).rows;
      expect(log).toEqual([{ actor_id: MANAGER, action: "status_changed" }]);
    });

    it("marks a manual hold with its own reason code so the hold is explainable", async () => {
      const id = await insertAs(OPERATOR_C07, centreC07, "C07-00113");
      await asUser(MANAGER, () => db.query("select review_entry($1, 'hold', 'Moisture reading looks wrong')", [id]));
      const row = await entry(id);
      expect(row.approval_status).toBe("held");
      expect(row.flag_reasons).toEqual(["manual_hold"]);
    });

    it("requires a reason to hold or reject", async () => {
      const id = await insertAs(OPERATOR_C07, centreC07, "C07-00109");
      const message = await asUser(MANAGER, () => failsWith(db.query("select review_entry($1, 'reject', '')", [id])));
      expect(message).toMatch(/reason/i);
    });

    it("refuses operators", async () => {
      const id = await insertAs(OPERATOR_C07, centreC07, "C07-00110", { rate: "5000" });
      const message = await asUser(OPERATOR_C07, () => failsWith(db.query("select review_entry($1, 'approve', null)", [id])));
      expect(message).toMatch(/only office managers/i);
      expect((await entry(id)).approval_status).toBe("held");
    });

    it("refuses once the entry is in a payment run", async () => {
      const id = await insertAs(OPERATOR_C07, centreC07, "C07-00111");
      await db.query("update procurement_entries set payment_status = 'in_run' where id = $1", [id]);
      const message = await asUser(MANAGER, () => failsWith(db.query("select review_entry($1, 'hold', 'second look needed')", [id])));
      expect(message).toMatch(/payment run/i);
    });
  });

  it("stops an operator silently editing an entry after it was approved", async () => {
    const id = await insertAs(OPERATOR_C07, centreC07, "C07-00112");
    const rows = await asUser(OPERATOR_C07, async () =>
      (await db.query("update procurement_entries set approval_status = 'held', review_note = 'x' where id = $1 returning id", [id])).rows);
    expect(rows).toEqual([]);
    expect((await entry(id)).approval_status).toBe("approved");
  });
});

describe("sample procurement seed", () => {
  it("inserts the three brief slips with the right figures and is safe to run twice", async () => {
    // Needs an operator for each of the two centres: the two test operators.
    const seed = fs.readFileSync(path.join(SUPABASE_DIR, "seed_procurement.sql"), "utf8");
    await db.exec(seed);
    await db.exec(seed);
    const rows = (await db.query<{ slip_no: string; net_kg: string; rate_per_quintal: string; amount: string; approval_status: string; flag_reasons: string[] }>(
      "select slip_no, net_kg, rate_per_quintal, amount, approval_status, flag_reasons from procurement_entries where slip_no in ('C07-24518','C07-24519','C12-08876') order by slip_no")).rows;
    expect(rows.map((r) => [r.slip_no, r.net_kg, r.rate_per_quintal, r.amount])).toEqual([
      ["C07-24518", "1232.0", "4850.00", "59752.00"],
      ["C07-24519", "831.0", "4850.00", "40303.50"],
      ["C12-08876", "630.0", "7200.00", "45360.00"],
    ]);
    expect(rows.every((r) => r.approval_status === "approved" && r.flag_reasons.length === 0)).toBe(true);
  });

  it("gives the sample slips hashes the app itself accepts, in an unbroken chain", async () => {
    const rows = (await db.query<Record<string, string | null>>(`
      select client_id, slip_no, farmer_id, centre_id, operator_id, crop, grade,
             gross_kg::text, tare_kg::text, moisture_pct::text, net_kg::text,
             rate_per_quintal::text, amount::text, device_id,
             to_char(device_recorded_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as at,
             payload_hash, prev_hash
        from procurement_entries
       where slip_no in ('C07-24518','C07-24519','C12-08876') order by device_id, device_recorded_at`)).rows;
    const entries = rows.map((r) => ({
      clientId: r.client_id!, slipNo: r.slip_no!, farmerId: r.farmer_id!, centreId: r.centre_id!,
      operatorId: r.operator_id!, crop: r.crop, grade: r.grade, grossKg: r.gross_kg!, tareKg: r.tare_kg!,
      moisturePct: r.moisture_pct!, netKg: r.net_kg!, ratePerQuintal: r.rate_per_quintal!, amount: r.amount!,
      deviceId: r.device_id!, deviceRecordedAt: r.at!, prevHash: r.prev_hash, clockOffsetMs: null,
      payloadHash: r.payload_hash!,
    })) as EntryRecord[];
    for (const e of entries) expect(await verifyPayloadHash(e)).toBe(true);
    expect(findChainBreak(entries.filter((e) => e.deviceId === "seed-device-c07"), null)).toBe(-1);
  });

  it("gives the sample slips hashes the app itself accepts, in an unbroken chain", async () => {
    const rows = (await db.query<Record<string, string | null>>(
      `select client_id, slip_no, farmer_id, centre_id, operator_id, crop, grade, gross_kg::text, tare_kg::text,
              moisture_pct::text, net_kg::text, rate_per_quintal::text, amount::text, device_id,
              to_char(device_recorded_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as at,
              payload_hash, prev_hash
         from procurement_entries where slip_no in ('C07-24518','C07-24519') order by device_recorded_at`)).rows;
    const entries = rows.map((r) => ({
      clientId: r.client_id!, slipNo: r.slip_no!, farmerId: r.farmer_id!, centreId: r.centre_id!, operatorId: r.operator_id!,
      crop: r.crop as "soybean", grade: r.grade as "A", grossKg: r.gross_kg!, tareKg: r.tare_kg!, moisturePct: r.moisture_pct!,
      netKg: r.net_kg!, ratePerQuintal: r.rate_per_quintal!, amount: r.amount!, deviceId: r.device_id!,
      deviceRecordedAt: r.at!, prevHash: r.prev_hash, clockOffsetMs: null, payloadHash: r.payload_hash!,
    }));
    for (const e of entries) expect(await verifyPayloadHash(e)).toBe(true);
    expect(findChainBreak(entries, null)).toBe(-1);
  });
});

describe("price board", () => {
  const draft = (date: string, crop: string, grade: string, rate: string | number, reason: string | null = null) =>
    asUser(MANAGER, async () =>
      (await db.query<{ id: string }>(
        `select create_price_draft(${date}, '${crop}', '${grade}', ${rate}, ${reason === null ? "null" : `'${reason}'`}) as id`)).rows[0].id);
  const publish = (...ids: string[]) =>
    asUser(MANAGER, () => db.query("select publish_prices($1::uuid[]) as n", [ids]));
  const version = async (id: string) =>
    (await db.query<Record<string, string | number | null>>("select * from price_versions where id = $1", [id])).rows[0];
  const audit = async (id: string) =>
    (await db.query<{ action: string; actor_id: string | null }>(
      "select action, actor_id from price_audit_logs where price_version_id = $1 order by created_at, action", [id])).rows;
  const TODAY = "public.ist_today()";

  describe("effective dates", () => {
    it("accepts today and up to 14 days ahead", async () => {
      await draft(TODAY, "tur", "C", 6900);
      await draft(`${TODAY} + 14`, "tur", "C", 6900);
    });

    it("refuses a past date and a date more than 14 days ahead", async () => {
      expect(await asUser(MANAGER, () => failsWith(db.query(`select create_price_draft(${TODAY} - 1, 'tur', 'B', 6900)`)))).toMatch(/effective date/i);
      expect(await asUser(MANAGER, () => failsWith(db.query(`select create_price_draft(${TODAY} + 15, 'tur', 'B', 6900)`)))).toMatch(/effective date/i);
    });

    it("refuses to publish a draft whose date has passed", async () => {
      const { rows } = await db.query<{ id: string }>(
        `insert into price_versions (price_date, crop, grade, version, rate_per_quintal, created_by)
         values (${TODAY} - 3, 'tur', 'B', 1, 6000, '${MANAGER}') returning id`);
      expect(await publish(rows[0].id).then(() => "published", (e) => e.message)).toMatch(/past date/i);
    });

    it("refuses rates that are zero, negative or have more than two decimals", async () => {
      for (const rate of ["0", "-5", "100.555", "100000"]) {
        const message = await asUser(MANAGER, () => failsWith(db.query(`select create_price_draft(${TODAY} + 2, 'soybean', 'C', ${rate})`)));
        expect(message).toMatch(/rate must be/i);
      }
    });
  });

  describe("drafts", () => {
    it("are visible to managers and hidden from operators", async () => {
      const id = await draft(`${TODAY} + 3`, "soybean", "C", 4400);
      const manager = await asUser(MANAGER, async () => (await db.query("select id from price_versions where id = $1", [id])).rows);
      const operator = await asUser(OPERATOR_C07, async () => (await db.query("select id from price_versions where id = $1", [id])).rows);
      expect(manager).toHaveLength(1);
      expect(operator).toEqual([]);
    });

    it("allow only one working draft per crop, grade and date", async () => {
      await draft(`${TODAY} + 4`, "soybean", "C", 4400);
      const message = await asUser(MANAGER, () => failsWith(db.query(`select create_price_draft(${TODAY} + 4, 'soybean', 'C', 4500)`)));
      expect(message).toMatch(/draft already exists/i);
    });

    it("can be edited and deleted before publishing, with both recorded", async () => {
      const id = await draft(`${TODAY} + 5`, "tur", "C", 6800);
      await asUser(MANAGER, () => db.query("select update_price_draft($1, 6850.50)", [id]));
      expect(Number((await version(id)).rate_per_quintal)).toBe(6850.5);
      await asUser(MANAGER, () => db.query("select delete_price_draft($1)", [id]));
      expect(await version(id)).toBeUndefined();
      expect((await audit(id)).map((a) => a.action).sort()).toEqual(["created", "draft_deleted", "edited"]);
    });

    it("can be created, edited and published by managers only", async () => {
      const id = await draft(`${TODAY} + 6`, "tur", "C", 6800);
      for (const sql of [
        `select create_price_draft(${TODAY} + 7, 'tur', 'C', 6800)`,
        `select update_price_draft('${id}', 1)`,
        `select delete_price_draft('${id}')`,
        `select publish_prices(array['${id}']::uuid[])`,
      ]) {
        expect(await asUser(OPERATOR_C07, () => failsWith(db.query(sql)))).toMatch(/only office managers/i);
      }
      expect((await version(id)).status).toBe("draft");
    });
  });

  describe("publishing", () => {
    it("makes the rate live for every centre and records who published it and when", async () => {
      const id = await draft(`${TODAY} + 8`, "soybean", "C", 4410);
      const published = await publish(id);
      expect(published.rows[0]).toMatchObject({ n: 1 });

      const v = await version(id);
      expect(v).toMatchObject({ status: "published", published_by: MANAGER, created_by: MANAGER, version: 1 });
      expect(v.published_at).toBeTruthy();

      for (const uid of [OPERATOR_C07, OPERATOR_C12]) {
        const live = await asUser(uid, async () => (await db.query<{ rate_per_quintal: string; version: number }>(
          `select rate_per_quintal::text, version from daily_prices where price_date = ${TODAY} + 8 and crop = 'soybean' and grade = 'C'`)).rows);
        expect(live).toEqual([{ rate_per_quintal: "4410.00", version: 1 }]);
      }
      expect((await audit(id)).map((a) => a.action)).toEqual(["created", "published"]);
    });

    it("is all or nothing", async () => {
      const good = await draft(`${TODAY} + 9`, "soybean", "C", 4400);
      const done = await draft(`${TODAY} + 9`, "tur", "C", 6900);
      await publish(done);
      const message = await publish(good, done).then(() => "published", (e) => e.message);
      expect(message).toMatch(/only an unpublished price/i);
      expect((await version(good)).status).toBe("draft");
    });
  });

  describe("published prices are immutable", () => {
    let id: string;
    beforeAll(async () => {
      id = await draft(`${TODAY} + 10`, "soybean", "C", 4420);
      await publish(id);
    });

    it("cannot be edited or deleted through the board functions", async () => {
      expect(await asUser(MANAGER, () => failsWith(db.query("select update_price_draft($1, 1)", [id])))).toMatch(/unpublished/i);
      expect(await asUser(MANAGER, () => failsWith(db.query("select delete_price_draft($1)", [id])))).toMatch(/unpublished/i);
    });

    it("cannot be changed by direct writes from a manager or an operator", async () => {
      for (const uid of [MANAGER, OPERATOR_C07]) {
        for (const sql of [
          `update price_versions set rate_per_quintal = 1 where id = '${id}' returning id`,
          `update daily_prices set rate_per_quintal = 1 where price_date = ${TODAY} + 10 and crop = 'soybean' and grade = 'C' returning id`,
          `delete from price_versions where id = '${id}' returning id`,
          `delete from daily_prices where price_date = ${TODAY} + 10 and crop = 'soybean' and grade = 'C' returning id`,
        ]) {
          const rows = await asUser(uid, async () => (await db.query(sql)).rows);
          expect(rows).toEqual([]);
        }
        const message = await asUser(uid, () =>
          failsWith(db.query(`insert into daily_prices (price_date, crop, grade, rate_per_quintal) values (${TODAY} + 11, 'tur', 'C', 1)`)));
        expect(message).toMatch(/row-level security/i);
      }
      expect(Number((await version(id)).rate_per_quintal)).toBe(4420);
    });

    it("is protected by a trigger even from a privileged session", async () => {
      for (const sql of [
        `update price_versions set rate_per_quintal = 1 where id = '${id}'`,
        `update price_versions set price_date = price_date + 1 where id = '${id}'`,
        `update price_versions set status = 'draft' where id = '${id}'`,
        `delete from price_versions where id = '${id}'`,
      ]) {
        expect(await failsWith(db.query(sql))).toMatch(/published price|identity|cannot/i);
      }
    });
  });

  describe("corrections", () => {
    let first: string;
    beforeAll(async () => {
      first = await draft(`${TODAY} + 12`, "tur", "C", 6900);
      await publish(first);
    });

    it("need a reason, and a different rate", async () => {
      expect(await asUser(MANAGER, () => failsWith(db.query(`select create_price_draft(${TODAY} + 12, 'tur', 'C', 6950)`)))).toMatch(/needs a reason/i);
      expect(await asUser(MANAGER, () => failsWith(db.query(`select create_price_draft(${TODAY} + 12, 'tur', 'C', 6900, 'typo in board')`)))).toMatch(/same as the published/i);
    });

    it("publish as a new version that supersedes the old one and keeps its history", async () => {
      const second = await draft(`${TODAY} + 12`, "tur", "C", 6950, "Mandi rate moved after noon");
      expect(await version(second)).toMatchObject({ version: 2, supersedes_id: first, correction_reason: "Mandi rate moved after noon" });
      // Until it is published, the live rate is unchanged.
      const before = await db.query(`select rate_per_quintal::text, version from daily_prices where price_date = ${TODAY} + 12 and crop = 'tur' and grade = 'C'`);
      expect(before.rows).toEqual([{ rate_per_quintal: "6900.00", version: 1 }]);

      await publish(second);
      const after = await db.query(`select rate_per_quintal::text, version from daily_prices where price_date = ${TODAY} + 12 and crop = 'tur' and grade = 'C'`);
      expect(after.rows).toEqual([{ rate_per_quintal: "6950.00", version: 2 }]);

      expect((await version(first)).status).toBe("superseded");
      expect(Number((await version(first)).rate_per_quintal)).toBe(6900);
      expect((await audit(first)).map((a) => a.action)).toEqual(["created", "published", "superseded"]);
      const history = await asUser(OPERATOR_C07, async () => (await db.query<{ version: number; status: string }>(
        `select version, status from price_versions where price_date = ${TODAY} + 12 and crop = 'tur' and grade = 'C' order by version`)).rows);
      expect(history).toEqual([{ version: 1, status: "superseded" }, { version: 2, status: "published" }]);
    });
  });

  it("gives rates inserted straight into the live table (the demo seed) a published history row", async () => {
    const rows = (await db.query<{ status: string; version: number }>(
      "select status, version from price_versions where price_date = current_date and crop = 'soybean' and grade = 'A'")).rows;
    expect(rows).toEqual([{ status: "published", version: 1 }]);
  });

  describe("rate snapshot on procurement entries", () => {
    // soybean C for today: a slot nothing else in this file uses.
    async function entry(slip: string, rate: string, rateVersion: number | null) {
      const { rows } = await db.query<{ id: string }>(`
        insert into procurement_entries
          (client_id, slip_no, farmer_id, centre_id, operator_id, crop, grade, gross_kg, tare_kg, moisture_pct,
           net_kg, rate_per_quintal, amount, device_id, device_recorded_at, payload_hash, rate_price_date, rate_version)
        select gen_random_uuid(), '${slip}', f.id, '${centreC07}', '${OPERATOR_C07}', 'soybean', 'C', 860.0, 12.0, 14.0,
               831.0, ${rate}, round(831.0 * ${rate} / 100, 2), 'dev-snap-0001', now(), repeat('c', 64),
               ${rateVersion === null ? "null" : "public.ist_today()"}, ${rateVersion ?? "null"}
          from farmer_members f where f.member_code = 'FM00101' returning id`);
      return rows[0].id;
    }
    const get = async (id: string) =>
      (await db.query<Record<string, unknown>>("select * from procurement_entries where id = $1", [id])).rows[0];
    let v1: string;

    beforeAll(async () => {
      v1 = await draft(TODAY, "soybean", "C", 4400);
      await publish(v1);
    });

    it("stores the rate, its effective date and its version with the entry", async () => {
      const id = await entry("C07-00201", "4400", 1);
      const row = await get(id);
      expect(row).toMatchObject({ approval_status: "approved", rate_version: 1 });
      expect(String(row.rate_per_quintal)).toBe("4400.00");
      expect(row.rate_price_date).toBeTruthy();
      const log = (await db.query<{ new_values: Record<string, unknown> }>(
        "select new_values from procurement_audit_logs where entry_id = $1 and action = 'created'", [id])).rows[0];
      expect(log.new_values).toMatchObject({ rate_version: 1, rate_per_quintal: 4400 });
    });

    it("holds an entry that claims a version which never carried that rate", async () => {
      const id = await entry("C07-00202", "4400", 7);
      expect((await get(id)).flag_reasons).toContain("rate_mismatch");
    });

    it("keeps the snapshot untouched when a correction is published later, and flags the older rate", async () => {
      const before = await entry("C07-00203", "4400", 1);
      const second = await draft(TODAY, "soybean", "C", 4450, "Corrected after market close");
      await publish(second);

      // The earlier entry still carries 4400 and version 1; nothing rewrote it.
      const kept = await get(before);
      expect(String(kept.rate_per_quintal)).toBe("4400.00");
      expect(kept.rate_version).toBe(1);

      // An offline phone that never saw the correction syncs an entry at the old rate.
      const stale = await entry("C07-00204", "4400", 1);
      const row = await get(stale);
      expect(row.flag_reasons).toEqual(["superseded_rate"]);
      expect(row.approval_status).toBe("held");
      expect(String(row.rate_per_quintal)).toBe("4400.00");

      const fresh = await entry("C07-00205", "4450", 2);
      expect((await get(fresh)).approval_status).toBe("approved");
    });

    it("never lets the stored rate be rewritten afterwards, even by a manager", async () => {
      const id = await entry("C07-00206", "4450", 2);
      for (const set of ["rate_per_quintal = 4000", "rate_version = 1", "rate_price_date = rate_price_date + 1"]) {
        expect(await asUser(MANAGER, () => failsWith(db.query(`update procurement_entries set ${set} where id = '${id}'`)))).toMatch(/immutable|check/i);
      }
    });
  });
});

describe("sms log", () => {
  let entryC07: string;
  let entryC12: string;
  let farmerId: string;
  const insertSms = (uid: string, centre: string, entryId: string, extra = "") =>
    asUser(uid, async () => (await db.query<{ id: string }>(`
      insert into sms_messages (entry_id, farmer_id, centre_id, recipient_masked, body, created_by ${extra ? ", " + extra.split("|")[0] : ""})
      values ('${entryId}', '${farmerId}', '${centre}', '+91 98****4321', 'रक्कम ₹40,303.50', '${uid}' ${extra ? ", " + extra.split("|")[1] : ""})
      returning id`)).rows[0].id);

  beforeAll(async () => {
    farmerId = (await db.query<{ id: string }>("select id from farmer_members where member_code = 'FM00101'")).rows[0].id;
    const mk = async (slip: string, centre: string, op: string) =>
      (await db.query<{ id: string }>(`
        insert into procurement_entries
          (client_id, slip_no, farmer_id, centre_id, operator_id, crop, grade, gross_kg, tare_kg, moisture_pct,
           net_kg, rate_per_quintal, amount, device_id, device_recorded_at, payload_hash)
        values (gen_random_uuid(), '${slip}', '${farmerId}', '${centre}', '${op}', 'soybean', 'A', 860.0, 12.0, 14.0,
                831.0, 4850, 40303.50, 'dev-sms-0001', now(), repeat('d', 64)) returning id`)).rows[0].id;
    entryC07 = await mk("C07-00301", centreC07, OPERATOR_C07);
    entryC12 = await mk("C12-00301", centreC12, OPERATOR_C12);
  });

  it("lets an operator log an SMS for their own centre, in sending state", async () => {
    const id = await insertSms(OPERATOR_C07, centreC07, entryC07);
    const row = (await db.query<Record<string, unknown>>("select * from sms_messages where id = $1", [id])).rows[0];
    expect(row).toMatchObject({ status: "sending", provider: "mock", attempts: 0, recipient_masked: "+91 98****4321" });
    expect(row.created_at).toBeTruthy();
  });

  it("allows only one slip SMS per entry", async () => {
    const message = await asUser(OPERATOR_C07, () => failsWith(insertSms(OPERATOR_C07, centreC07, entryC07)));
    expect(message).toMatch(/duplicate|unique/i);
  });

  it("refuses to store an unmasked phone number", async () => {
    const message = await failsWith(db.query(`
      insert into sms_messages (entry_id, farmer_id, centre_id, recipient_masked, body, created_by)
      values ('${entryC12}', '${farmerId}', '${centreC12}', '+919876543210', 'x', '${OPERATOR_C12}')`));
    expect(message).toMatch(/recipient_masked|check/i);
  });

  it("keeps one centre's SMS log away from another centre's operator", async () => {
    const other = await asUser(OPERATOR_C12, async () => (await db.query("select id from sms_messages")).rows);
    expect(other).toEqual([]);
    const message = await asUser(OPERATOR_C12, () => failsWith(insertSms(OPERATOR_C12, centreC07, entryC07)));
    expect(message).toMatch(/row-level security/i);
    const manager = await asUser(MANAGER, async () => (await db.query("select id from sms_messages")).rows);
    expect(manager.length).toBeGreaterThan(0);
  });

  it("requires a reason for a failure, never edits the message, and never un-delivers", async () => {
    const id = await insertSms(OPERATOR_C12, centreC12, entryC12);
    expect(await asUser(OPERATOR_C12, () => failsWith(db.query("update sms_messages set status = 'failed' where id = $1", [id])))).toMatch(/failed_has_reason|check/i);
    expect(await asUser(OPERATOR_C12, () => failsWith(db.query("update sms_messages set body = 'changed' where id = $1", [id])))).toMatch(/cannot be edited/i);

    await asUser(OPERATOR_C12, () => db.query("update sms_messages set status = 'delivered', status_at = now() where id = $1", [id]));
    expect(await asUser(OPERATOR_C12, () => failsWith(db.query("update sms_messages set status = 'failed', failure_reason = 'x' where id = $1", [id])))).toMatch(/delivered/i);
  });
});
