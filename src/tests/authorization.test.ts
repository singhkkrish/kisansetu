import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authorize } from "@/lib/auth/guard";
import {
  MANAGER_PROFILE,
  OPERATOR_PROFILE,
  USER,
  fakeSupabase,
  type FakeSupabaseOptions,
} from "./fake-supabase";

// The routes build their Supabase client through this module, so tests can
// hand them a fake without any network.
const current = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => current.client as SupabaseClient,
}));

import { GET as listMembers, POST as createMember } from "@/app/api/members/route";
import { GET as getMember, PUT as updateMember } from "@/app/api/members/[id]/route";
import { POST as verifyBank } from "@/app/api/members/[id]/verify-bank/route";

const MEMBER_ID = "44444444-4444-4444-8444-444444444444";
const CENTRE_ID = "22222222-2222-4222-8222-222222222222";

const validBody = {
  fullName: "Sunil Jadhav",
  village: "Ganjur",
  centreId: CENTRE_ID,
  phone: "9000000101",
  landAcres: "14.50",
  crops: ["soybean"],
  consentConfirmed: true,
  bank: { holderName: "Sunil Jadhav", accountNumber: "504618608387888", ifsc: "SBIN0012874" },
};

const memberRow = {
  id: MEMBER_ID,
  member_code: "FM00101",
  full_name: "Sunil Jadhav",
  village: "Ganjur",
  centre_id: CENTRE_ID,
  land_acres: 14.5,
  crops: ["soybean"],
  active: true,
  bank_verified: true,
  phone: "9000000101",
  consent_recorded_at: "2026-11-02T06:00:00Z",
  created_at: "2026-11-02T06:00:00Z",
  centres: { code: "C07", name: "Ganjur Collection Centre" },
};

const bankRow = {
  holder_name: "Sunil Jadhav",
  account_number: "504618608387888",
  ifsc: "SBIN0012874",
  verified: true,
  verified_at: "2026-11-02T06:00:00Z",
};

function use(options: FakeSupabaseOptions) {
  const fake = fakeSupabase(options);
  current.client = fake.client;
  return fake;
}

function json(method: string, body: unknown, rawBody?: string) {
  return new Request("http://localhost/api/members", {
    method,
    headers: { "Content-Type": "application/json" },
    body: rawBody ?? JSON.stringify(body),
  });
}

const idContext = (id = MEMBER_ID) => ({ params: Promise.resolve({ id }) });

beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
});

beforeEach(() => {
  current.client = null;
});

describe("authorize()", () => {
  it("returns 401 when nobody is signed in", async () => {
    const { client } = fakeSupabase({ user: null });
    expect(await authorize(client, "members:read")).toEqual({
      ok: false, status: 401, error: expect.any(String),
    });
  });

  it("returns 403 for a signed-in user with no staff profile", async () => {
    const { client } = fakeSupabase({ user: USER, tables: {} });
    expect(await authorize(client, "members:read")).toMatchObject({ ok: false, status: 403 });
  });

  it("returns 403 for a deactivated staff member", async () => {
    const { client } = fakeSupabase({ user: USER, tables: { profiles: { ...MANAGER_PROFILE, active: false } } });
    expect(await authorize(client, "members:read")).toMatchObject({ ok: false, status: 403 });
  });

  it("returns 403 for a role it does not recognise", async () => {
    const { client } = fakeSupabase({ user: USER, tables: { profiles: { role: "superadmin", centre_id: null, active: true } } });
    expect(await authorize(client, "members:read")).toMatchObject({ ok: false, status: 403 });
  });

  it("returns 403 for an operator who is not assigned to a centre", async () => {
    const { client } = fakeSupabase({ user: USER, tables: { profiles: { ...OPERATOR_PROFILE, centre_id: null } } });
    expect(await authorize(client, "members:read")).toMatchObject({ ok: false, status: 403 });
  });

  it("returns 403 when the role lacks the permission", async () => {
    const { client } = fakeSupabase({ user: USER, tables: { profiles: OPERATOR_PROFILE } });
    expect(await authorize(client, "members:write")).toMatchObject({ ok: false, status: 403 });
    expect(await authorize(client, "prices:write")).toMatchObject({ ok: false, status: 403 });
    expect(await authorize(client, "payment_runs:approve")).toMatchObject({ ok: false, status: 403 });
  });

  it("lets each role do what it is allowed to", async () => {
    const operator = fakeSupabase({ user: USER, tables: { profiles: OPERATOR_PROFILE } }).client;
    const manager = fakeSupabase({ user: USER, tables: { profiles: MANAGER_PROFILE } }).client;
    expect(await authorize(operator, "procurement:create")).toMatchObject({ ok: true, user: { role: "centre_operator", centreId: CENTRE_ID } });
    expect(await authorize(manager, "prices:write")).toMatchObject({ ok: true, user: { role: "office_manager" } });
  });
});

describe("POST /api/members (register a farmer)", () => {
  it("rejects a signed-out request and never touches the database", async () => {
    const fake = use({ user: null });
    const response = await createMember(json("POST", validBody));
    expect(response.status).toBe(401);
    expect(fake.rpcCalls).toEqual([]);
  });

  it("rejects a centre operator", async () => {
    const fake = use({ user: USER, tables: { profiles: OPERATOR_PROFILE } });
    const response = await createMember(json("POST", validBody));
    expect(response.status).toBe(403);
    expect(fake.rpcCalls).toEqual([]);
  });

  it("rejects a deactivated manager", async () => {
    const fake = use({ user: USER, tables: { profiles: { ...MANAGER_PROFILE, active: false } } });
    expect((await createMember(json("POST", validBody))).status).toBe(403);
    expect(fake.rpcCalls).toEqual([]);
  });

  it("answers 503 when the server has no Supabase configuration", async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    try {
      const response = await createMember(json("POST", validBody));
      expect(response.status).toBe(503);
    } finally {
      process.env.NEXT_PUBLIC_SUPABASE_URL = url;
    }
  });

  it("returns field errors for invalid bank details and does not call the database", async () => {
    const fake = use({ user: USER, tables: { profiles: MANAGER_PROFILE } });
    const response = await createMember(
      json("POST", { ...validBody, bank: { holderName: "Sunil Jadhav", accountNumber: "123", ifsc: "nope" } }),
    );
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.fieldErrors).toHaveProperty(["bank.accountNumber"]);
    expect(body.fieldErrors).toHaveProperty(["bank.ifsc"]);
    expect(fake.rpcCalls).toEqual([]);
  });

  it("refuses a request that includes an Aadhaar number", async () => {
    const fake = use({ user: USER, tables: { profiles: MANAGER_PROFILE } });
    const response = await createMember(json("POST", { ...validBody, aadhaar: "234567890123" }));
    expect(response.status).toBe(422);
    expect(fake.rpcCalls).toEqual([]);
  });

  it("rejects malformed and oversized bodies", async () => {
    use({ user: USER, tables: { profiles: MANAGER_PROFILE } });
    expect((await createMember(json("POST", null, "{not json"))).status).toBe(400);
    expect((await createMember(json("POST", null, JSON.stringify({ x: "a".repeat(30_000) })))).status).toBe(413);
  });

  it("registers a farmer for a manager, sending clean values to the database function", async () => {
    const fake = use({
      user: USER,
      tables: { profiles: MANAGER_PROFILE },
      rpc: () => ({ data: { id: MEMBER_ID, member_code: "FM00204" } }),
    });
    const response = await createMember(
      json("POST", { ...validBody, bank: { ...validBody.bank, ifsc: "sbin0012874", accountNumber: "5046 1860 8387 888" } }),
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: MEMBER_ID, memberCode: "FM00204" });
    expect(fake.rpcCalls).toHaveLength(1);
    expect(fake.rpcCalls[0]).toMatchObject({
      name: "register_farmer",
      args: { p: { full_name: "Sunil Jadhav", bank: { account_number: "504618608387888", ifsc: "SBIN0012874" } } },
    });
  });

  it("turns database errors into safe messages", async () => {
    use({
      user: USER,
      tables: { profiles: MANAGER_PROFILE },
      rpc: () => ({ error: { code: "XX000", message: 'relation "farmer_bank_accounts" secret detail' } }),
    });
    const response = await createMember(json("POST", validBody));
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("secret detail");
  });

  it("maps a database permission error to 403", async () => {
    use({ user: USER, tables: { profiles: MANAGER_PROFILE }, rpc: () => ({ error: { code: "42501" } }) });
    expect((await createMember(json("POST", validBody))).status).toBe(403);
  });
});

describe("GET /api/members (search)", () => {
  it("requires sign-in", async () => {
    use({ user: null });
    expect((await listMembers(new Request("http://localhost/api/members"))).status).toBe(401);
  });

  it("lets a centre operator search", async () => {
    use({ user: USER, tables: { profiles: OPERATOR_PROFILE }, lists: { farmer_members: [memberRow] } });
    const response = await listMembers(new Request("http://localhost/api/members?q=sunil"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.rows[0]).toMatchObject({ memberCode: "FM00101", bankVerified: true });
  });

  it("never includes bank details in search results", async () => {
    use({ user: USER, tables: { profiles: MANAGER_PROFILE }, lists: { farmer_members: [{ ...memberRow, account_number: "504618608387888" }] } });
    const text = await (await listMembers(new Request("http://localhost/api/members"))).text();
    expect(text).not.toContain("504618608387888");
    expect(text).not.toMatch(/ifsc|account/i);
  });
});

describe("GET /api/members/[id] (details)", () => {
  it("gives a manager the masked bank account, never the full number", async () => {
    use({ user: USER, tables: { profiles: MANAGER_PROFILE, farmer_members: memberRow, farmer_bank_accounts: bankRow } });
    const response = await getMember(new Request("http://localhost/api/members/x"), idContext());
    expect(response.status).toBe(200);
    const text = await response.text();
    const body = JSON.parse(text);
    expect(body.bank).toMatchObject({ accountMasked: "XXXXXXXXXXX7888", ifsc: "SBIN0012874", verified: true });
    expect(text).not.toContain("504618608387888");
  });

  it("gives a centre operator the farmer but never queries or returns bank details", async () => {
    const fake = use({ user: USER, tables: { profiles: OPERATOR_PROFILE, farmer_members: memberRow, farmer_bank_accounts: bankRow } });
    const response = await getMember(new Request("http://localhost/api/members/x"), idContext());
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(JSON.parse(text)).not.toHaveProperty("bank");
    expect(text).not.toMatch(/ifsc|account|504618608387888/i);
    expect(fake.queriedTables).not.toContain("farmer_bank_accounts");
  });

  it("answers 404 for an id that is not a uuid, without querying", async () => {
    const fake = use({ user: USER, tables: { profiles: MANAGER_PROFILE } });
    const response = await getMember(new Request("http://localhost/api/members/x"), idContext("not-a-uuid"));
    expect(response.status).toBe(404);
    expect(fake.queriedTables).not.toContain("farmer_members");
  });

  it("answers 404 when the farmer does not exist", async () => {
    use({ user: USER, tables: { profiles: MANAGER_PROFILE } });
    expect((await getMember(new Request("http://localhost/api/members/x"), idContext())).status).toBe(404);
  });
});

describe("PUT /api/members/[id] (edit a farmer)", () => {
  const { consentConfirmed: _consent, ...editBody } = validBody;

  it("rejects signed-out requests and centre operators", async () => {
    let fake = use({ user: null });
    expect((await updateMember(json("PUT", editBody), idContext())).status).toBe(401);
    expect(fake.rpcCalls).toEqual([]);

    fake = use({ user: USER, tables: { profiles: OPERATOR_PROFILE } });
    expect((await updateMember(json("PUT", editBody), idContext())).status).toBe(403);
    expect(fake.rpcCalls).toEqual([]);
  });

  it("validates the body", async () => {
    const fake = use({ user: USER, tables: { profiles: MANAGER_PROFILE } });
    const response = await updateMember(json("PUT", { ...editBody, landAcres: "0" }), idContext());
    expect(response.status).toBe(422);
    expect(fake.rpcCalls).toEqual([]);
  });

  it("lets a manager keep the stored account number by leaving it out", async () => {
    const fake = use({ user: USER, tables: { profiles: MANAGER_PROFILE } });
    const response = await updateMember(
      json("PUT", { ...editBody, bank: { holderName: "Sunil Jadhav", accountNumber: "", ifsc: "SBIN0012874" } }),
      idContext(),
    );
    expect(response.status).toBe(200);
    expect(fake.rpcCalls[0]).toMatchObject({
      name: "update_farmer",
      args: { p_id: MEMBER_ID, p: { bank: { account_number: "", ifsc: "SBIN0012874" } } },
    });
  });

  it("answers 404 when the database says the farmer is missing", async () => {
    use({ user: USER, tables: { profiles: MANAGER_PROFILE }, rpc: () => ({ error: { code: "P0002" } }) });
    expect((await updateMember(json("PUT", editBody), idContext())).status).toBe(404);
  });
});

describe("POST /api/members/[id]/verify-bank", () => {
  const request = () => new Request("http://localhost/api/members/x/verify-bank", { method: "POST" });

  it("is refused for signed-out users and centre operators", async () => {
    let fake = use({ user: null });
    expect((await verifyBank(request(), idContext())).status).toBe(401);
    fake = use({ user: USER, tables: { profiles: OPERATOR_PROFILE } });
    expect((await verifyBank(request(), idContext())).status).toBe(403);
    expect(fake.rpcCalls).toEqual([]);
  });

  it("is allowed for an office manager", async () => {
    const fake = use({ user: USER, tables: { profiles: MANAGER_PROFILE } });
    const response = await verifyBank(request(), idContext());
    expect(response.status).toBe(200);
    expect(fake.rpcCalls[0]).toMatchObject({ name: "verify_farmer_bank", args: { p_id: MEMBER_ID } });
  });

  it("answers 404 when there is no bank account to verify", async () => {
    use({ user: USER, tables: { profiles: MANAGER_PROFILE }, rpc: () => ({ error: { code: "P0002" } }) });
    expect((await verifyBank(request(), idContext())).status).toBe(404);
  });
});
