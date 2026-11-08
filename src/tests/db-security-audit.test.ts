import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/** Catalogue-level checks on the real migrations, so a new table or function cannot quietly skip the rules. */
const SUPABASE_DIR = path.resolve(import.meta.dirname, "../../supabase");
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create schema auth;
    create table auth.users (id uuid primary key, email text, raw_app_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    create role authenticated; create role anon;
    grant usage on schema auth to authenticated, anon;
  `);
  for (const file of fs.readdirSync(path.join(SUPABASE_DIR, "migrations")).sort()) {
    await db.exec(fs.readFileSync(path.join(SUPABASE_DIR, "migrations", file), "utf8"));
  }
}, 60_000);
afterAll(async () => {
  await db.close();
});

describe("row level security", () => {
  it("is enabled on every table in the public schema", async () => {
    const { rows } = await db.query<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity order by 1`);
    expect(rows.map((r) => r.relname)).toEqual([]);
  });

  it("has no policy that opens a table to everyone", async () => {
    const { rows } = await db.query<{ tablename: string; policyname: string; qual: string | null; with_check: string | null; roles: string }>(
      "select tablename, policyname, qual, with_check, roles::text from pg_policies where schemaname = 'public'");
    // The centre list (code and name) is deliberately readable by any signed-in user; it holds nothing sensitive.
    const open = rows.filter((r) => /public|anon/.test(r.roles) || r.qual?.trim() === "true" || r.with_check?.trim() === "true").filter((r) => r.policyname !== "centres_read");
    expect(open.map((r) => `${r.tablename}.${r.policyname}`)).toEqual([]);
  });

  it("gives staff no insert, update or delete policy on money, audit or anomaly tables", async () => {
    const { rows } = await db.query<{ tablename: string; cmd: string }>(
      `select tablename, cmd from pg_policies where schemaname = 'public' and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
          and tablename in ('payment_runs', 'payment_items', 'payment_run_entries', 'payment_audit_logs', 'procurement_audit_logs',
                            'anomaly_flags', 'anomaly_settings', 'anomaly_setting_logs', 'farmer_bank_accounts', 'daily_prices', 'price_versions', 'dispatches')`);
    expect(rows).toEqual([]);
  });
});

describe("database functions", () => {
  it("pin their search path when they run with the owner's rights", async () => {
    const { rows } = await db.query<{ proname: string }>(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prosecdef
          and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%') order by 1`);
    expect(rows.map((r) => r.proname)).toEqual([]);
  });

  it("are not executable by the public role unless deliberately granted", async () => {
    const { rows } = await db.query<{ proname: string }>(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prosecdef and has_function_privilege('public', p.oid, 'execute')
          and p.proname not in ('app_role', 'app_centre_id', 'ist_today') order by 1`);
    // Functions that act for a signed-in person must check who they are; anything listed here is a finding.
    expect(rows.map((r) => r.proname)).toEqual([]);
  });
});
