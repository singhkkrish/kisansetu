import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MANAGER_PROFILE, OPERATOR_PROFILE, USER, fakeSupabase, type FakeSupabaseOptions } from "./fake-supabase";

const current = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => current.client as SupabaseClient }));

import { POST as createRun } from "@/app/api/payment-runs/route";
import { POST as approveRun } from "@/app/api/payment-runs/[id]/approve/route";
import { POST as cancelRun } from "@/app/api/payment-runs/[id]/cancel/route";
import { POST as bankFile } from "@/app/api/payment-runs/[id]/bank-file/route";
import { POST as simulate } from "@/app/api/payment-runs/[id]/simulate/route";
import { POST as releaseItem } from "@/app/api/payment-items/[id]/release/route";
import { POST as dispatch } from "@/app/api/dispatches/route";
import { POST as review } from "@/app/api/procurement/[id]/review/route";
import { getRun } from "@/lib/services/payments";

const RUN = "44444444-4444-4444-8444-444444444444";
const ITEM = "55555555-5555-4555-8555-555555555555";
const CENTRE = "22222222-2222-4222-8222-222222222222";
const ENTRY = "66666666-6666-4666-8666-666666666666";

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
const manager = (extra: FakeSupabaseOptions = {}) => withClient({ user: USER, tables: { profiles: MANAGER_PROFILE }, ...extra });
const operator = (extra: FakeSupabaseOptions = {}) => withClient({ user: USER, tables: { profiles: OPERATOR_PROFILE }, ...extra });
const signedOut = () => withClient({ user: null });

const post = (body?: unknown) =>
  new Request("http://localhost/api/x", { method: "POST", headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const ctx = (id = RUN) => ({ params: Promise.resolve({ id }) });

const runBody = { from: "2026-11-01", to: "2026-11-05", centreIds: [CENTRE] };
const dispatchBody = { centreId: CENTRE, crop: "tur", weightKg: "395.0", bookKg: "400.0", destination: "Latur APMC", truckNo: "MH24AB1234" };

type Call = () => Promise<Response>;
const everyRoute: [string, Call][] = [
  ["create run", () => createRun(post(runBody))],
  ["approve run", () => approveRun(post(), ctx())],
  ["cancel run", () => cancelRun(post({ reason: "Wrong dates chosen" }), ctx())],
  ["bank file", () => bankFile(post(), ctx())],
  ["simulate", () => simulate(post({ itemIds: [ITEM], outcome: "paid" }), ctx())],
  ["release item", () => releaseItem(post(), ctx(ITEM))],
  ["dispatch", () => dispatch(post(dispatchBody))],
  ["review entry", () => review(post({ decision: "approve" }), ctx(ENTRY))],
];

describe("role-based authorization of payment, stock and review routes", () => {
  it.each(everyRoute)("%s: a signed-out request is refused and never reaches the database", async (_name, call) => {
    const fake = signedOut();
    expect((await call()).status).toBe(401);
    expect(fake.rpcCalls).toEqual([]);
  });

  it.each(everyRoute)("%s: a centre operator is refused and never reaches the database", async (_name, call) => {
    const fake = operator();
    expect((await call()).status).toBe(403);
    expect(fake.rpcCalls).toEqual([]);
    expect(fake.queriedTables).toEqual(["profiles"]); // only the permission lookup
  });

  it.each(everyRoute.filter(([n]) => n !== "review entry"))("%s: an inactive manager is refused", async (_name, call) => {
    const fake = withClient({ user: USER, tables: { profiles: { ...MANAGER_PROFILE, active: false } } });
    expect((await call()).status).toBe(403);
    expect(fake.rpcCalls).toEqual([]);
  });
});

describe("generating a payment run", () => {
  it("passes only the dates and centres to the database function", async () => {
    const fake = manager({ rpc: () => ({ data: { run_id: RUN, run_no: "PR-20261105-001", total_amount: 100 } }) });
    const response = await createRun(post({ ...runBody, centreIds: [CENTRE, CENTRE] }));
    expect(response.status).toBe(201);
    expect(fake.rpcCalls).toEqual([{ name: "create_payment_run", args: { p_from: "2026-11-01", p_to: "2026-11-05", p_centre_ids: [CENTRE, CENTRE] } }]);
  });

  it("ignores any amount or entry list the browser tries to send", async () => {
    const fake = manager();
    const response = await createRun(post({ ...runBody, totalAmount: "1", entryIds: [ENTRY] }));
    expect(response.status).toBe(422);
    expect(fake.rpcCalls).toEqual([]);
  });

  it("rejects bad input with 422", async () => {
    manager();
    expect((await createRun(post({ ...runBody, centreIds: [] }))).status).toBe(422);
    expect((await createRun(post({ ...runBody, from: "2026-12-01" }))).status).toBe(422);
    expect((await createRun(post({ ...runBody, from: "yesterday" }))).status).toBe(422);
  });

  it("turns 'nothing to pay' (already in a run) into a clear 409, without database text", async () => {
    manager({ rpc: () => ({ error: { code: "23514", message: "ks:no_eligible_entries" } }) });
    const response = await createRun(post(runBody));
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toMatch(/in a payment run/i);
    expect(JSON.stringify(body)).not.toContain("ks:");
  });

  it("never leaks an unknown database error", async () => {
    manager({ rpc: () => ({ error: { code: "XX000", message: "relation payment_runs secret detail" } }) });
    const response = await createRun(post(runBody));
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("secret");
  });
});

describe("approving, cancelling and downloading", () => {
  it("approves through the database function", async () => {
    const fake = manager();
    expect((await approveRun(post(), ctx())).status).toBe(200);
    expect(fake.rpcCalls).toEqual([{ name: "approve_payment_run", args: { p_run_id: RUN } }]);
  });

  it("returns 409 when the run is in the wrong state", async () => {
    manager({ rpc: () => ({ error: { code: "23514", message: "ks:bad_state" } }) });
    expect((await approveRun(post(), ctx())).status).toBe(409);
  });

  it("returns 404 for an id that is not a uuid, before any database call", async () => {
    const fake = manager();
    expect((await approveRun(post(), ctx("not-a-uuid"))).status).toBe(404);
    expect(fake.rpcCalls).toEqual([]);
  });

  it("requires a reason to cancel", async () => {
    const fake = manager();
    expect((await cancelRun(post({ reason: "no" }), ctx())).status).toBe(422);
    expect(fake.rpcCalls).toEqual([]);
  });

  it("refuses the bank file for a run that is not approved", async () => {
    manager({ rpc: () => ({ error: { code: "23514", message: "ks:not_approved" } }) });
    const response = await bankFile(post(), ctx());
    expect(response.status).toBe(409);
    expect(response.headers.get("Content-Type")).not.toContain("text/csv");
  });

  it("returns the mock CSV for an approved run, marked as a mock file", async () => {
    const fake = manager({
      rpc: () => ({ data: { file_name: "KISANSETU-MOCK-PR-20261105-001.csv", first: true } }),
      tables: { profiles: MANAGER_PROFILE, payment_runs: { run_no: "PR-20261105-001", bank_file_name: "KISANSETU-MOCK-PR-20261105-001.csv" } },
      lists: {
        payment_items: [
          { farmer_code: "FM00102", beneficiary_name: "Kamal Shinde", account_number: "58089406541324", ifsc: "SBIN0012874", amount: 40303.5, payment_ref: "PR-20261105-001-002" },
          { farmer_code: "FM00101", beneficiary_name: "Sunil Jadhav", account_number: "504618608387888", ifsc: "SBIN0012874", amount: 59752, payment_ref: "PR-20261105-001-001" },
        ],
      },
    });
    const response = await bankFile(post(), ctx());
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/csv");
    expect(response.headers.get("Content-Disposition")).toContain("KISANSETU-MOCK-PR-20261105-001.csv");
    expect(response.headers.get("X-Mock-Bank-File")).toBe("true");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const text = await response.text();
    expect(text.split("\r\n")).toEqual([
      "beneficiary_name,account_number,ifsc,amount,payment_ref,payment_run_id",
      "Sunil Jadhav,504618608387888,SBIN0012874,59752.00,PR-20261105-001-001,PR-20261105-001",
      "Kamal Shinde,58089406541324,SBIN0012874,40303.50,PR-20261105-001-002,PR-20261105-001",
      "",
    ]);
    expect(fake.rpcCalls[0]).toEqual({ name: "start_bank_file", args: { p_run_id: RUN } });
  });
});

describe("simulated bank responses", () => {
  it("passes the outcome and reason to the database", async () => {
    const fake = manager({ lists: { payment_items: [{ id: ITEM }] }, rpc: () => ({ data: 1 }) });
    const response = await simulate(post({ itemIds: [ITEM, ITEM], outcome: "failed", reason: "Account closed" }), ctx());
    expect(response.status).toBe(200);
    expect(fake.rpcCalls).toEqual([{ name: "simulate_bank_response", args: { p_item_ids: [ITEM], p_outcome: "failed", p_reason: "Account closed" } }]);
  });

  it("does not send a reason with a success", async () => {
    const fake = manager({ lists: { payment_items: [{ id: ITEM }] }, rpc: () => ({ data: 1 }) });
    await simulate(post({ itemIds: [ITEM], outcome: "paid", reason: "ignored" }), ctx());
    expect(fake.rpcCalls[0].args).toMatchObject({ p_outcome: "paid", p_reason: null });
  });

  it("requires a reason for a failure", async () => {
    const fake = manager({ lists: { payment_items: [{ id: ITEM }] } });
    expect((await simulate(post({ itemIds: [ITEM], outcome: "failed" }), ctx())).status).toBe(422);
    expect(fake.rpcCalls).toEqual([]);
  });

  it("refuses items that do not belong to the run in the URL", async () => {
    const fake = manager({ lists: { payment_items: [] } });
    expect((await simulate(post({ itemIds: [ITEM], outcome: "paid" }), ctx())).status).toBe(404);
    expect(fake.rpcCalls).toEqual([]);
  });

  it("refuses to settle a payment that is not processing, or already settled", async () => {
    manager({ lists: { payment_items: [{ id: ITEM }] }, rpc: () => ({ error: { code: "23514", message: "ks:item_not_processing" } }) });
    expect((await simulate(post({ itemIds: [ITEM], outcome: "paid" }), ctx())).status).toBe(409);
  });

  it("returns a failed payment's entries to unpaid through the database function", async () => {
    const fake = manager();
    expect((await releaseItem(post(), ctx(ITEM))).status).toBe(200);
    expect(fake.rpcCalls).toEqual([{ name: "release_failed_item", args: { p_item_id: ITEM } }]);
  });
});

describe("dispatch route", () => {
  it("normalises and forwards the details; stock figures come from the database", async () => {
    const fake = manager({ rpc: () => ({ data: { dispatch_no: "DS-20261105-001", stock_before_kg: 4800, stock_after_kg: 4400 } }) });
    const response = await dispatch(post({ ...dispatchBody, truckNo: "mh 24 ab 1234", dispatchedAt: "2026-11-05T06:00:00+05:30" }));
    expect(response.status).toBe(201);
    expect(fake.rpcCalls[0]).toEqual({
      name: "record_dispatch",
      args: { p_centre: CENTRE, p_crop: "tur", p_weight: "395.0", p_book: "400.0", p_destination: "Latur APMC", p_truck: "MH24AB1234", p_dispatched_at: "2026-11-05T06:00:00+05:30" },
    });
  });

  it("uses the weighed weight as the book quantity when none is given", async () => {
    const fake = manager({ rpc: () => ({ data: {} }) });
    const { bookKg: _omit, ...rest } = dispatchBody;
    void _omit;
    await dispatch(post(rest));
    expect(fake.rpcCalls[0].args).toMatchObject({ p_weight: "395.0", p_book: "395.0", p_dispatched_at: null });
  });

  it("rejects bad input with field errors and does not call the database", async () => {
    const fake = manager();
    const response = await dispatch(post({ ...dispatchBody, weightKg: "-3", truckNo: "X" }));
    expect(response.status).toBe(422);
    expect(Object.keys((await response.json()).fieldErrors)).toEqual(expect.arrayContaining(["weightKg", "truckNo"]));
    expect(fake.rpcCalls).toEqual([]);
  });

  it("explains an insufficient stock refusal", async () => {
    manager({ rpc: () => ({ error: { code: "23514", message: "ks:insufficient_stock" } }) });
    const response = await dispatch(post(dispatchBody));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/not enough stock/i);
  });
});

describe("review route keeps anomalies in human hands", () => {
  it("lets a manager approve, hold or reject, with a reason for the last two", async () => {
    const fake = manager();
    expect((await review(post({ decision: "approve" }), ctx(ENTRY))).status).toBe(200);
    expect((await review(post({ decision: "hold" }), ctx(ENTRY))).status).toBe(422);
    expect((await review(post({ decision: "reject", note: "Duplicate slip" }), ctx(ENTRY))).status).toBe(200);
    expect(fake.rpcCalls.map((c) => (c.args as { p_decision: string }).p_decision)).toEqual(["approve", "reject"]);
  });
});

describe("payment run detail never exposes full account numbers", () => {
  it("masks the account number before it leaves the service", async () => {
    const { client } = fakeSupabase({
      user: USER,
      tables: { payment_runs: { id: RUN, run_no: "PR-20261105-001", status: "approved", date_from: "2026-11-01", date_to: "2026-11-05", item_count: 1, entry_count: 2, total_amount: 59752, created_at: "2026-11-05T10:00:00Z", centre_ids: [CENTRE], payment_items: [] } },
      lists: {
        payment_items: [{ id: ITEM, farmer_code: "FM00101", farmer_name: "Sunil Jadhav", beneficiary_name: "Sunil Jadhav", account_number: "504618608387888", ifsc: "SBIN0012874", entry_count: 2, amount: 59752, payment_ref: "PR-20261105-001-001", status: "pending" }],
        centres: [{ id: CENTRE, code: "C07", name: "Ganjur" }],
      },
    });
    const detail = await getRun(client, RUN);
    expect(detail?.items[0].accountMasked).toBe("XXXXXXXXXXX7888");
    expect(JSON.stringify(detail)).not.toContain("504618608387888");
    expect(detail?.items[0].amount).toBe("59752.00");
  });
});
