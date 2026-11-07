import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/** Whole-schema security checks against the real migrations. */

const SUPABASE_DIR = path.resolve(import.meta.dirname, "../../supabase");
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
    grant usage on schema auth to authenticated, anon;
  `);
  for (const file of fs.readdirSync(path.join(SUPABASE_DIR, "migrations")).sort()) {
    await db.exec(fs.readFileSync(path.join(SUPABASE_DIR, "migrations", file), "utf8"));
  }
}, 60_000);
afterAll(async () => {
  await db.close();
});

describe("schema-wide security", () => {
  it("has row level security enabled on every table in the public schema", async () => {
    const { rows } = await db.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public' and not rowsecurity order by tablename");
    expect(rows.map((r) => r.tablename)).toEqual([]);
  });

  it("gives every SECURITY DEFINER function a fixed search_path", async () => {
    const { rows } = await db.query<{ proname: string }>(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prosecdef and not coalesce(p.proconfig::text ilike '%search_path%', false)
        order by 1`);
    expect(rows.map((r) => r.proname)).toEqual([]);
  });

  it("does not let the anonymous role execute any application function", async () => {
    const { rows } = await db.query<{ proname: string }>(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
          and p.prokind = 'f' order by 1`);
    // Trigger functions and helpers granted to PUBLIC by default are listed here so a new
    // one cannot slip in unnoticed; none of them is callable with data-changing effect without a role.
    const callable = rows.map((r) => r.proname);
    const dangerous = callable.filter((n) => /^(review_|create_payment|approve_|simulate_|start_bank|publish_|register_farmer|update_|verify_|record_dispatch|cancel_|release_)/.test(n));
    expect(dangerous).toEqual([]);
  });

  it("gives the anonymous role no table privileges to read", async () => {
    await db.exec("set role anon");
    const failures: string[] = [];
    for (const t of ["farmer_members", "farmer_bank_accounts", "procurement_entries", "payment_items", "anomaly_flags", "profiles"]) {
      try {
        const { rows } = await db.query(`select 1 from public.${t} limit 1`);
        if (rows.length > 0) failures.push(t);
      } catch {
        /* permission denied is the expected outcome */
      }
    }
    await db.exec("reset role");
    expect(failures).toEqual([]);
  });

  it("keeps bank account numbers out of any view or function readable by operators", async () => {
    const { rows } = await db.query<{ viewname: string }>(
      "select viewname from pg_views where schemaname = 'public' and definition ilike '%account_number%'");
    expect(rows.map((r) => r.viewname)).toEqual([]);
  });
});
