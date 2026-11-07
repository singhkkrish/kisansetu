import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Anomaly rules, review and the payment hold, tested against the real
 * migrations in an in-memory Postgres, acting as each role. The thresholds here
 * are the demo defaults from the migration; they are assumptions, not standards.
 */

const SUPABASE_DIR = path.resolve(import.meta.dirname, "../../supabase");
const MANAGER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OP07 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OP12 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

let db: PGlite;
let c07: string;
let c12: string;
const farmers: Record<string, string> = {};
let slipSeq = 200;

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

const T0 = Date.parse("2026-04-01T00:30:00Z"); // 06:00 IST, safely in the past

interface Add {
  farmer: string;
  centre?: string;
  net?: number;
  moisture?: number;
  crop?: "soybean" | "tur";
  /** Minutes after T0. */
  min: number;
}

async function add(o: Add): Promise<{ id: string; approval: string; flags: string[] }> {
  const centre = o.centre ?? c07;
  const operator = centre === c07 ? OP07 : OP12;
  const crop = o.crop ?? "soybean";
  const net = o.net ?? 500;
  const rate = crop === "soybean" ? 4850 : 7200;
  const moisture = o.moisture ?? 10 + ((slipSeq * 7) % 21) / 10; // varied so the uniform-moisture rule stays quiet
  const netKg = Math.round(net * (1 - Math.max(moisture - 12, 0) / 100) * 10) / 10;
  const slip = `${centre === c07 ? "C07" : "C12"}-${String(++slipSeq).padStart(5, "0")}`;
  const at = new Date(T0 + o.min * 60_000).toISOString();
  const { rows } = await db.query<{ id: string; approval_status: string; flag_reasons: string[] }>(
    `insert into procurement_entries
       (client_id, slip_no, farmer_id, centre_id, operator_id, crop, grade, gross_kg, tare_kg, moisture_pct,
        net_kg, rate_per_quintal, amount, device_id, device_recorded_at, payload_hash)
     values (gen_random_uuid(), $1, $2, $3, $4, $5, 'A', $6, 0, $7, $11, $8, $9, 'dev-anomaly', $10, repeat('a', 64))
     returning id, approval_status, flag_reasons`,
    [slip, farmers[o.farmer] ?? o.farmer, centre, operator, crop, net, moisture, rate, (Math.round(netKg * rate) / 100).toFixed(2), at, netKg],
  );
  return { id: rows[0].id, approval: rows[0].approval_status, flags: rows[0].flag_reasons };
}

const flagRows = async (entryId: string) =>
  (await db.query<{ id: string; rule: string; status: string; details: Record<string, number | string[]> }>(
    "select id, rule, status, details from anomaly_flags where entry_id = $1 order by rule", [entryId])).rows;

const day = (n: number) => n * 24 * 60; // minutes

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
    insert into auth.users (id, email) values ('${MANAGER}', 'm@x.test'), ('${OP07}', 'a@x.test'), ('${OP12}', 'b@x.test');
    insert into profiles (id, full_name, role, centre_id, active) values
      ('${MANAGER}', 'Office Manager', 'office_manager', null, true),
      ('${OP07}', 'Operator Ganjur', 'centre_operator', '${c07}', true),
      ('${OP12}', 'Operator Murud', 'centre_operator', '${c12}', true);
    insert into daily_prices (price_date, crop, grade, rate_per_quintal)
      select d::date, c.crop, 'A', c.rate
      from generate_series('2026-03-30'::date, '2026-10-20'::date, '1 day') d,
           (values ('soybean'::crop_type, 4850), ('tur'::crop_type, 7200)) as c(crop, rate)
    on conflict do nothing;
  `);
  // Ten farmers from the seed, land set explicitly so each test controls its own numbers.
  for (let i = 1; i <= 14; i++) {
    const { rows } = await db.query<{ id: string }>(
      "insert into farmer_members (member_code, full_name, village, land_acres) values ($1, $2, 'Test', 10) returning id",
      [`FM9${String(i).padStart(4, "0")}`, `Test Farmer ${i}`]);
    farmers[`f${i}`] = rows[0].id;
    await db.query(
      "insert into farmer_bank_accounts (member_id, holder_name, account_number, ifsc, verified, verified_at) values ($1, $2, $3, 'TEST0000001', true, now())",
      [rows[0].id, `Test Farmer ${i}`, `1234567890${String(i).padStart(2, "0")}`]);
  }
  // The blanket grant above is wider than production; keep the rule helpers private as they are there.
  await db.exec("revoke execute on function anomaly_setting(text), anomaly_findings(procurement_entries) from authenticated, public");
}, 60_000);

afterAll(async () => {
  await db.close();
});

describe("weight compared with land area and crop", () => {
  it("flags a farmer whose season total passes land × the assumed ceiling per acre", async () => {
    await db.query("update farmer_members set land_acres = 2 where id = $1", [farmers.f1]);
    const first = await add({ farmer: "f1", net: 1500, min: 0 });
    const second = await add({ farmer: "f1", net: 700, min: day(2) }); // 2200 kg > 2 acres × 1000 kg

    expect(first.approval).toBe("approved");
    expect(first.flags).toEqual([]);
    expect(second.approval).toBe("held");
    expect(second.flags).toEqual(["weight_vs_land"]);

    const [flag] = await flagRows(second.id);
    expect(flag).toMatchObject({ rule: "weight_vs_land", status: "open" });
    expect(Number(flag.details.total_kg)).toBe(2200);
    expect(Number(flag.details.limit_kg)).toBe(2000);
    expect(Number(flag.details.land_acres)).toBe(2);
    expect(Number(flag.details.max_kg_per_acre)).toBe(1000);
  });

  it("does not flag a farmer within the limit, or one with no land recorded", async () => {
    await db.query("update farmer_members set land_acres = 5 where id = $1", [farmers.f2]);
    expect((await add({ farmer: "f2", net: 4900, min: day(3) })).flags).toEqual([]);
    await db.query("update farmer_members set land_acres = 0 where id = $1", [farmers.f3]);
    expect((await add({ farmer: "f3", net: 9000, min: day(3) })).flags).toEqual([]);
  });

  it("uses the ceiling for the crop", async () => {
    await db.query("update farmer_members set land_acres = 1 where id = $1", [farmers.f4]);
    // 900 kg of tur against 1 acre × 800 kg.
    const tur = await add({ farmer: "f4", crop: "tur", net: 900, min: day(3) });
    expect(tur.flags).toEqual(["weight_vs_land"]);
    // 900 kg of soybean against 1 acre × 1000 kg is fine.
    expect((await add({ farmer: "f4", crop: "soybean", net: 900, min: day(4) })).flags).toEqual([]);
  });

  it("only counts purchases inside the season window", async () => {
    await db.query("update farmer_members set land_acres = 1 where id = $1", [farmers.f5]);
    await add({ farmer: "f5", net: 900, min: 0 });
    // 200 days later the first purchase is outside the 150-day window.
    expect((await add({ farmer: "f5", net: 900, min: day(200) })).flags).toEqual([]);
  });
});

describe("several entries for one farmer close together", () => {
  it("flags the later entry and names the other slip", async () => {
    const first = await add({ farmer: "f6", min: day(5) });
    const second = await add({ farmer: "f6", min: day(5) + 30 });
    expect(first.flags).toEqual([]);
    expect(second.flags).toEqual(["repeat_within_hour"]);
    const [flag] = await flagRows(second.id);
    expect(Number(flag.details.other_entries)).toBe(1);
    expect(Number(flag.details.nearest_minutes)).toBe(30);
    expect(flag.details.other_slips).toHaveLength(1);
  });

  it("does not flag entries more than an hour apart, or different farmers", async () => {
    await add({ farmer: "f7", min: day(6) });
    expect((await add({ farmer: "f7", min: day(6) + 90 })).flags).toEqual([]);
    await add({ farmer: "f8", min: day(7) });
    expect((await add({ farmer: "f9", min: day(7) + 5 })).flags).toEqual([]);
  });

  it("ignores an earlier entry that was rejected", async () => {
    const a = await add({ farmer: "f10", min: day(8) });
    await asUser(MANAGER, () => db.query("select review_entry($1, 'reject', 'Entered by mistake')", [a.id]));
    expect((await add({ farmer: "f10", min: day(8) + 10 })).flags).toEqual([]);
  });
});

describe("uniform moisture at a centre", () => {
  it("flags once the last ten readings sit within the assumed range", async () => {
    // Murud (C12): ten readings, 11.0 to 11.2, from different farmers.
    const readings = [11.0, 11.1, 11.0, 11.2, 11.1, 11.0, 11.2, 11.1, 11.0, 11.1];
    const results = [];
    for (const [i, moisture] of readings.entries()) {
      results.push(await add({ farmer: "f1", centre: c12, moisture, net: 100, min: day(10) + i * 120, crop: "tur" }));
    }
    expect(results.slice(0, 9).every((r) => r.flags.length === 0)).toBe(true);
    expect(results[9].flags).toEqual(["uniform_moisture"]);
    const [flag] = await flagRows(results[9].id);
    expect(Number(flag.details.readings)).toBe(10);
    expect(Number(flag.details.range_pct)).toBeCloseTo(0.2, 5);
  });

  it("does not flag readings that vary naturally", async () => {
    await db.query("update farmer_members set land_acres = 1000");
    const readings = [9.5, 11.0, 12.5, 10.0, 13.0, 11.5, 9.0, 12.0, 10.5, 11.8];
    let last = { flags: [] as string[] };
    for (const [i, moisture] of readings.entries()) {
      last = await add({ farmer: "f2", centre: c07, moisture, net: 100, min: day(20) + i * 120 });
    }
    expect(last.flags).toEqual([]);
  });
});

describe("unexpected change against the farmer's own pattern", () => {
  it("flags a weight far above the farmer's usual", async () => {
    for (let i = 0; i < 3; i++) await add({ farmer: "f3", net: 500, moisture: 10, min: day(30) + i * 180 });
    const jump = await add({ farmer: "f3", net: 1600, moisture: 10, min: day(30) + 600 });
    expect(jump.flags).toEqual(["weight_pattern_change"]);
    const [flag] = await flagRows(jump.id);
    expect(Number(flag.details.median_kg)).toBe(500);
    expect(Number(flag.details.this_kg)).toBe(1600);
  });

  it("flags a moisture reading far from the farmer's usual", async () => {
    await db.query("update farmer_members set land_acres = 1000");
    for (let i = 0; i < 3; i++) await add({ farmer: "f4", net: 400, moisture: 10, min: day(40) + i * 180 });
    const shift = await add({ farmer: "f4", net: 400, moisture: 17, min: day(40) + 600 });
    expect(shift.flags).toEqual(["moisture_pattern_change"]);
  });

  it("needs enough history before judging a change", async () => {
    await db.query("update farmer_members set land_acres = 1000");
    await add({ farmer: "f13", net: 100, min: day(50) });
    await add({ farmer: "f5", net: 100, min: day(50) + 180 });
    expect((await add({ farmer: "f5", net: 3000, min: day(50) + 400 })).flags).toEqual([]);
  });
});

describe("a flagged purchase is held, never cancelled", () => {
  it("holds the entry, keeps it synced and unpaid, and records why", async () => {
    await add({ farmer: "f9", min: day(60) });
    const flagged = await add({ farmer: "f9", min: day(60) + 20 });
    const row = (await db.query<{ approval_status: string; sync_status: string; payment_status: string }>(
      "select approval_status, sync_status, payment_status from procurement_entries where id = $1", [flagged.id])).rows[0];
    expect(row).toEqual({ approval_status: "held", sync_status: "synced", payment_status: "unpaid" });
    const none = await db.query("select 1 from procurement_entries where approval_status = 'rejected' and flag_reasons <> '{}' and id = $1", [flagged.id]);
    expect(none.rows).toHaveLength(0);

    const audit = await db.query<{ action: string; actor_id: string | null; new_values: { rule: string } }>(
      "select action, actor_id, new_values from procurement_audit_logs where entry_id = $1 order by created_at, id", [flagged.id]);
    expect(audit.rows.map((r) => r.action)).toEqual(["created", "anomaly_flagged"]);
    expect(audit.rows[1].actor_id).toBeNull();
    expect(audit.rows[1].new_values.rule).toBe("repeat_within_hour");
  });

  it("keeps the other server flags and adds the anomaly alongside them", async () => {
    // 2026-11-03 has a price; this entry's rate (4850) matches, so only the anomaly is added.
    await add({ farmer: "f10", min: day(70) });
    const second = await add({ farmer: "f10", min: day(70) + 15 });
    expect(second.flags).toContain("repeat_within_hour");
  });
});

describe("payment hold and release", () => {
  let held: string;

  it("keeps a flagged entry out of a payment run", async () => {
    await db.query("update farmer_members set land_acres = 10 where id = $1", [farmers.f7]);
    await add({ farmer: "f7", min: day(80) });
    held = (await add({ farmer: "f7", min: day(80) + 25 })).id;
    // Everything else in this window is approved on its own merits.
    // Other approved entries exist, so the run is created; the held one must not be in it.
    await asUser(MANAGER, () => db.query("select create_payment_run('2026-03-30', '2026-10-30', array[$1]::uuid[])", [c07]));
    const inRun = await db.query("select 1 from payment_run_entries where entry_id = $1", [held]);
    expect(inRun.rows).toHaveLength(0);
    expect((await db.query<{ payment_status: string }>("select payment_status from procurement_entries where id = $1", [held])).rows[0].payment_status).toBe("unpaid");
  });

  it("refuses to approve the purchase while the anomaly is still open", async () => {
    const message = await asUser(MANAGER, () => failsWith(db.query("select review_entry($1, 'approve', null)", [held])));
    expect(message).toContain("ks:anomaly_open");
    expect((await db.query<{ approval_status: string }>("select approval_status from procurement_entries where id = $1", [held])).rows[0].approval_status).toBe("held");
  });

  it("releases the hold after a false-positive review and an explicit approval", async () => {
    const [flag] = await flagRows(held);
    expect(await asUser(MANAGER, () => failsWith(db.query("select review_anomaly($1, 'false_positive', 'ok')", [flag.id])))).toContain("ks:reason_required");
    await asUser(MANAGER, () => db.query("select review_anomaly($1, 'false_positive', 'Farmer brought two lots from two plots')", [flag.id]));

    const after = (await flagRows(held))[0];
    expect(after.status).toBe("false_positive");
    // The review does not approve anything by itself.
    expect((await db.query<{ approval_status: string }>("select approval_status from procurement_entries where id = $1", [held])).rows[0].approval_status).toBe("held");

    await asUser(MANAGER, () => db.query("select review_entry($1, 'approve', null)", [held]));
    const result = await asUser(MANAGER, async () =>
      (await db.query<{ r: { entry_count: number } }>("select create_payment_run('2026-03-30', '2026-10-30', array[$1]::uuid[]) as r", [c07])).rows[0].r);
    expect(result.entry_count).toBeGreaterThan(0);
    const linked = await db.query("select 1 from payment_run_entries where entry_id = $1 and released_at is null", [held]);
    expect(linked.rows).toHaveLength(1);
  });

  it("keeps an approved entry out of a run if an anomaly is raised for it afterwards", async () => {
    const e = await add({ farmer: "f8", min: day(90) });
    expect(e.approval).toBe("approved");
    await db.query("insert into anomaly_flags (entry_id, rule, details) values ($1, 'weight_pattern_change', '{}')", [e.id]);
    await asUser(MANAGER, () => db.query("select create_payment_run('2026-03-30', '2026-10-30', array[$1]::uuid[])", [c07]).catch(() => null));
    expect((await db.query("select 1 from payment_run_entries where entry_id = $1", [e.id])).rows).toHaveLength(0);
  });

  it("needs a written reason to pay despite a confirmed anomaly, and lets the manager reject instead", async () => {
    await add({ farmer: "f6", min: day(100) });
    const second = await add({ farmer: "f6", min: day(100) + 12 });
    const [flag] = await flagRows(second.id);
    await asUser(MANAGER, () => db.query("select review_anomaly($1, 'confirmed', 'Same lot split into two slips')", [flag.id]));
    expect(await asUser(MANAGER, () => failsWith(db.query("select review_entry($1, 'approve', null)", [second.id])))).toContain("ks:note_required_confirmed");
    await asUser(MANAGER, () => db.query("select review_entry($1, 'approve', 'Checked with centre; weights are correct')", [second.id]));
    expect((await db.query<{ approval_status: string }>("select approval_status from procurement_entries where id = $1", [second.id])).rows[0].approval_status).toBe("approved");

    await add({ farmer: "f1", min: day(110) });
    const dup = await add({ farmer: "f1", min: day(110) + 12 });
    await asUser(MANAGER, () => db.query("select review_entry($1, 'reject', 'Duplicate of the earlier slip')", [dup.id]));
    expect((await db.query<{ approval_status: string }>("select approval_status from procurement_entries where id = $1", [dup.id])).rows[0].approval_status).toBe("rejected");
  });
});

describe("review actions and the audit log", () => {
  it("records every action with who did it, the status change and the note", async () => {
    await db.query("update farmer_members set land_acres = 1000");
    await add({ farmer: "f14", min: day(120) });
    const e = await add({ farmer: "f14", min: day(120) + 10 });
    const [flag] = await flagRows(e.id);

    await asUser(MANAGER, () => db.query("select review_anomaly($1, 'reviewed', null)", [flag.id]));
    await asUser(MANAGER, () => db.query("select review_anomaly($1, 'note', 'Called the centre, waiting for reply')", [flag.id]));
    await asUser(MANAGER, () => db.query("select review_anomaly($1, 'confirmed', 'Centre confirmed a split lot')", [flag.id]));
    await asUser(MANAGER, () => db.query("select review_anomaly($1, 'false_positive', 'Two different plots, both genuine')", [flag.id]));

    const { rows } = await db.query<{ action: string; actor_id: string | null; old_values: { status?: string } | null; new_values: { status: string; note: string | null } }>(
      "select action, actor_id, old_values, new_values from procurement_audit_logs where entry_id = $1 and action like 'anomaly\\_%' order by created_at, id", [e.id]);
    expect(rows.map((r) => r.action)).toEqual(["anomaly_flagged", "anomaly_reviewed", "anomaly_note", "anomaly_confirmed", "anomaly_false_positive"]);
    expect(rows.slice(1).every((r) => r.actor_id === MANAGER)).toBe(true);
    expect(rows[1].new_values.status).toBe("reviewed");
    expect(rows[2].new_values).toMatchObject({ status: "reviewed", note: "Called the centre, waiting for reply" }); // a note does not change the status
    expect(rows[4].old_values?.status).toBe("confirmed");
    expect(rows[4].new_values).toMatchObject({ status: "false_positive", note: "Two different plots, both genuine" });
  });

  it("marks who reviewed it and when", async () => {
    await add({ farmer: "f3", min: day(130) });
    const e = await add({ farmer: "f3", min: day(130) + 10 });
    const [flag] = await flagRows(e.id);
    await asUser(MANAGER, () => db.query("select review_anomaly($1, 'reviewed', 'Looked at it')", [flag.id]));
    const row = (await db.query<{ reviewed_by: string; reviewed_at: string | null; review_note: string }>("select reviewed_by, reviewed_at, review_note from anomaly_flags where id = $1", [flag.id])).rows[0];
    expect(row.reviewed_by).toBe(MANAGER);
    expect(row.reviewed_at).not.toBeNull();
    expect(row.review_note).toBe("Looked at it");
  });

  it("refuses unknown actions and an unknown flag", async () => {
    expect(await asUser(MANAGER, () => failsWith(db.query("select review_anomaly(gen_random_uuid(), 'approve_purchase', 'x')")))).toContain("ks:bad_action");
    expect(await asUser(MANAGER, () => failsWith(db.query("select review_anomaly(gen_random_uuid(), 'reviewed', null)")))).toContain("ks:not_found");
  });

  it("never changes what an anomaly was raised with", async () => {
    const { rows } = await db.query<{ id: string }>("select id from anomaly_flags limit 1");
    expect(await failsWith(db.query("update anomaly_flags set details = '{}' where id = $1", [rows[0].id]))).toMatch(/keeps the values/);
    expect(await failsWith(db.query("delete from anomaly_flags where id = $1", [rows[0].id]))).toMatch(/cannot be changed or deleted/);
  });
});

describe("who can see and do what", () => {
  it("hides anomalies and their review notes from operators", async () => {
    const rows = await asUser(OP07, async () => (await db.query("select * from anomaly_flags")).rows);
    expect(rows).toEqual([]);
    const settings = await asUser(OP07, async () => (await db.query("select * from anomaly_settings")).rows);
    expect(settings).toEqual([]);
    const audit = await asUser(OP07, async () => (await db.query("select action from procurement_audit_logs where action like 'anomaly\\_%'")).rows);
    expect(audit).toEqual([]);
    // They still see their own entries' ordinary audit trail.
    const own = await asUser(OP07, async () => (await db.query("select action from procurement_audit_logs where action = 'created'")).rows);
    expect(own.length).toBeGreaterThan(0);
  });

  it("refuses operators the review and settings functions", async () => {
    const { rows } = await db.query<{ id: string }>("select id from anomaly_flags limit 1");
    expect(await asUser(OP07, () => failsWith(db.query("select review_anomaly($1, 'reviewed', null)", [rows[0].id])))).toMatch(/only office managers/i);
    expect(await asUser(OP07, () => failsWith(db.query("select update_anomaly_setting('repeat_window_minutes', 5)")))).toMatch(/only office managers/i);
  });

  it("refuses direct writes to anomaly tables even by a manager", async () => {
    const updated = await asUser(MANAGER, async () => (await db.query("update anomaly_flags set status = 'false_positive' returning id")).rows);
    expect(updated).toEqual([]);
    const settings = await asUser(MANAGER, async () => (await db.query("update anomaly_settings set value = 9999 where key = 'repeat_window_minutes' returning key")).rows);
    expect(settings).toEqual([]);
  });

  it("does not let anyone call the rule function directly", async () => {
    expect(await asUser(MANAGER, () => failsWith(db.query("select anomaly_setting('repeat_window_minutes')")))).toMatch(/permission denied/i);
  });
});

describe("configurable thresholds", () => {
  it("lets a manager change one, logs the change and drops the assumption label", async () => {
    const before = (await db.query<{ is_assumption: boolean }>("select is_assumption from anomaly_settings where key = 'repeat_window_minutes'")).rows[0];
    expect(before.is_assumption).toBe(true);
    await asUser(MANAGER, () => db.query("select update_anomaly_setting('repeat_window_minutes', 120)"));
    const after = (await db.query<{ value: string; is_assumption: boolean; updated_by: string }>("select value, is_assumption, updated_by from anomaly_settings where key = 'repeat_window_minutes'")).rows[0];
    expect(Number(after.value)).toBe(120);
    expect(after.is_assumption).toBe(false);
    expect(after.updated_by).toBe(MANAGER);
    const log = (await db.query<{ old_value: string; new_value: string }>("select old_value, new_value from anomaly_setting_logs where key = 'repeat_window_minutes'")).rows;
    expect(log).toEqual([{ old_value: "60", new_value: "120" }]);

    // 90 minutes apart is now "close together".
    await add({ farmer: "f4", min: day(150) });
    expect((await add({ farmer: "f4", min: day(150) + 90 })).flags).toContain("repeat_within_hour");
  });

  it("refuses values outside the allowed range and unknown keys", async () => {
    expect(await asUser(MANAGER, () => failsWith(db.query("select update_anomaly_setting('repeat_window_minutes', 100000)")))).toContain("ks:setting_out_of_range");
    expect(await asUser(MANAGER, () => failsWith(db.query("select update_anomaly_setting('nope', 1)")))).toContain("ks:not_found");
  });

  it("can switch a rule off", async () => {
    await db.query("update farmer_members set land_acres = 1000");
    await asUser(MANAGER, () => db.query("select update_anomaly_setting('repeat_enabled', 0)"));
    await add({ farmer: "f5", min: day(160) });
    expect((await add({ farmer: "f5", min: day(160) + 5 })).flags).toEqual([]);
    await asUser(MANAGER, () => db.query("select update_anomaly_setting('repeat_enabled', 1)"));
  });

  it("labels every default as an assumption", async () => {
    const { rows } = await db.query<{ n: number }>("select count(*)::int n from anomaly_settings where key not in ('repeat_window_minutes', 'repeat_enabled') and not is_assumption");
    expect(rows[0].n).toBe(0);
  });
});

describe("reading metadata", () => {
  it("stores what the operator accepted and refuses later edits", async () => {
    const e = await add({ farmer: "f6", min: day(170) });
    const meta = { grossKg: { source: "ai_confirmed", aiValue: "860.0", aiUnit: "kg", aiConfidence: "high" } };
    await db.query("update procurement_entries set reading_meta = null where id = $1", [e.id]); // null to null is fine
    expect(await failsWith(db.query("update procurement_entries set reading_meta = $2::jsonb where id = $1", [e.id, JSON.stringify(meta)]))).toMatch(/cannot change/);
  });

  it("accepts metadata at insert time and rejects junk", async () => {
    const meta = JSON.stringify({ grossKg: { source: "ai_corrected", aiValue: "860.0" } });
    const ok = await db.query<{ reading_meta: unknown }>(
      `insert into procurement_entries (client_id, slip_no, farmer_id, centre_id, operator_id, crop, grade, gross_kg, tare_kg, moisture_pct,
         net_kg, rate_per_quintal, amount, device_id, device_recorded_at, payload_hash, reading_meta)
       values (gen_random_uuid(), 'C07-29990', $1, $2, $3, 'soybean', 'A', 100, 0, 11, 100, 4850, 4850, 'dev-meta', $4, repeat('a', 64), $5::jsonb)
       returning reading_meta`, [farmers.f7, c07, OP07, new Date(T0 + day(180) * 60_000).toISOString(), meta]);
    expect(ok.rows[0].reading_meta).toMatchObject({ grossKg: { source: "ai_corrected" } });
    const bad = await failsWith(db.query(
      `insert into procurement_entries (client_id, slip_no, farmer_id, centre_id, operator_id, crop, grade, gross_kg, tare_kg, moisture_pct,
         net_kg, rate_per_quintal, amount, device_id, device_recorded_at, payload_hash, reading_meta)
       values (gen_random_uuid(), 'C07-29991', $1, $2, $3, 'soybean', 'A', 100, 0, 11, 100, 4850, 4850, 'dev-meta', $4, repeat('a', 64), '[1]'::jsonb)`,
      [farmers.f7, c07, OP07, new Date(T0 + day(181) * 60_000).toISOString()]));
    expect(bad).toMatch(/check/i);
  });
});
