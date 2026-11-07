import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MANAGER_PROFILE, OPERATOR_PROFILE, USER, fakeSupabase } from "./fake-supabase";

const current = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => current.client as SupabaseClient }));

import { POST as readDisplayRoute } from "@/app/api/ai/read-display/route";
import { handleReadDisplay } from "@/lib/ai/handler";
import { createAnthropicVision, type VisionCall } from "@/lib/ai/anthropic";
import { sniffImage, MAX_IMAGE_BYTES } from "@/lib/ai/image";
import { interpretModelOutput } from "@/lib/ai/interpret";
import { resetRateLimit, allowRequest } from "@/lib/ai/rate-limit";
import { readDisplay } from "@/lib/ai/read-display";
import { readingResultSchema, readingsSchema } from "@/lib/ai/schemas";

const jpeg = (size = 4096) => {
  const b = new Uint8Array(size);
  b.set([0xff, 0xd8, 0xff, 0xe0]);
  return b;
};
const png = () => {
  const b = new Uint8Array(2048);
  b.set([0x89, 0x50, 0x4e, 0x47]);
  return b;
};
const webp = () => {
  const b = new Uint8Array(2048);
  b.set([...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBP")]);
  return b;
};

const scaleOut = (over: Record<string, unknown> = {}) => ({ readable: true, weight: 860, unit: "kg", confidence: "high", problem: "none", ...over });
const moistureOut = (over: Record<string, unknown> = {}) => ({ readable: true, moisture_pct: 11.4, confidence: "high", problem: "none", ...over });

beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
});
beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "sk-ant-test-key-do-not-leak";
  delete process.env.ANTHROPIC_MODEL;
  delete process.env.ANTHROPIC_TIMEOUT_MS;
  resetRateLimit();
  current.client = null;
});
afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
});

describe("image checks", () => {
  it("accepts JPEG, PNG and WebP by their bytes", () => {
    expect(sniffImage(jpeg())).toEqual({ ok: true, mediaType: "image/jpeg" });
    expect(sniffImage(png())).toEqual({ ok: true, mediaType: "image/png" });
    expect(sniffImage(webp())).toEqual({ ok: true, mediaType: "image/webp" });
  });
  it("refuses formats it does not support", () => {
    const gif = new Uint8Array(2048);
    gif.set(Buffer.from("GIF89a"));
    const heic = new Uint8Array(2048);
    heic.set([0, 0, 0, 0x18, ...Buffer.from("ftypheic")]);
    const pdf = new Uint8Array(2048);
    pdf.set(Buffer.from("%PDF-1.7"));
    for (const bytes of [gif, heic, pdf]) expect(sniffImage(bytes)).toEqual({ ok: false, code: "unsupported_format" });
  });
  it("refuses files that are not images, empty files and oversized files", () => {
    expect(sniffImage(new Uint8Array(4096).fill(65))).toEqual({ ok: false, code: "invalid_image" });
    expect(sniffImage(new Uint8Array(0))).toEqual({ ok: false, code: "invalid_image" });
    expect(sniffImage(jpeg(100))).toEqual({ ok: false, code: "invalid_image" });
    expect(sniffImage(jpeg(MAX_IMAGE_BYTES + 1))).toEqual({ ok: false, code: "too_large" });
  });
});

describe("interpreting the model's answer", () => {
  it("accepts a clear scale reading as a suggestion in kilograms", () => {
    expect(interpretModelOutput("scale", scaleOut())).toEqual({
      status: "ok", kind: "scale", value: "860.0", displayed: { value: "860", unit: "kg" }, confidence: "high", caution: false,
    });
  });
  it("converts units to kilograms", () => {
    expect(interpretModelOutput("scale", scaleOut({ weight: 860500, unit: "g" }))).toMatchObject({ status: "ok", value: "860.5" });
    expect(interpretModelOutput("scale", scaleOut({ weight: 1000, unit: "lb" }))).toMatchObject({ status: "ok", value: "453.6" });
    expect(interpretModelOutput("scale", scaleOut({ weight: 8.6, unit: "quintal" }))).toMatchObject({ status: "ok", value: "860.0" });
  });
  it("asks the operator when the unit is not visible", () => {
    expect(interpretModelOutput("scale", scaleOut({ unit: "unknown" }))).toEqual({ status: "uncertain", kind: "scale", reason: "unit_unclear" });
  });
  it("accepts a clear moisture reading", () => {
    expect(interpretModelOutput("moisture", moistureOut())).toMatchObject({ status: "ok", value: "11.4", displayed: { value: "11.4", unit: "%" } });
  });
  it("adds a caution to a medium-confidence reading", () => {
    expect(interpretModelOutput("scale", scaleOut({ confidence: "medium" }))).toMatchObject({ status: "ok", confidence: "medium", caution: true });
  });

  it("withholds the value when confidence is low", () => {
    for (const result of [interpretModelOutput("scale", scaleOut({ confidence: "low" })), interpretModelOutput("moisture", moistureOut({ confidence: "low" }))]) {
      expect(result).toMatchObject({ status: "uncertain", reason: "low_confidence" });
      expect(JSON.stringify(result)).not.toMatch(/860|11\.4/);
    }
  });
  it("withholds the value when the display is not readable", () => {
    const result = interpretModelOutput("scale", scaleOut({ readable: false, weight: 860 }));
    expect(result).toEqual({ status: "uncertain", kind: "scale", reason: "unreadable" });
  });
  it("reports poor photos and photos of something else", () => {
    expect(interpretModelOutput("scale", scaleOut({ readable: false, weight: null, problem: "glare" }))).toEqual({ status: "failed", kind: "scale", code: "poor_quality" });
    expect(interpretModelOutput("moisture", moistureOut({ readable: false, moisture_pct: null, problem: "blurry" }))).toEqual({ status: "failed", kind: "moisture", code: "poor_quality" });
    expect(interpretModelOutput("scale", scaleOut({ readable: false, weight: null, problem: "not_a_display" }))).toEqual({ status: "failed", kind: "scale", code: "invalid_image" });
  });
  it("reports a missing value", () => {
    expect(interpretModelOutput("scale", scaleOut({ weight: null }))).toEqual({ status: "failed", kind: "scale", code: "missing_value" });
    expect(interpretModelOutput("moisture", moistureOut({ moisture_pct: null }))).toEqual({ status: "failed", kind: "moisture", code: "missing_value" });
  });
  it("does not trust implausible numbers", () => {
    expect(interpretModelOutput("scale", scaleOut({ weight: 90000 }))).toMatchObject({ status: "uncertain", reason: "implausible" });
    expect(interpretModelOutput("scale", scaleOut({ weight: 0 }))).toMatchObject({ status: "uncertain", reason: "implausible" });
    expect(interpretModelOutput("moisture", moistureOut({ moisture_pct: 400 }))).toMatchObject({ status: "uncertain", reason: "implausible" });
  });
  it.each([
    ["a missing field", { readable: true, weight: 5, unit: "kg", confidence: "high" }],
    ["a text number", scaleOut({ weight: "860" })],
    ["an unknown field the model added", scaleOut({ approve: true })],
    ["an unknown unit", scaleOut({ unit: "stone" })],
    ["not an object", "860 kg"],
    ["null", null],
  ])("treats %s as a malformed response", (_name, raw) => {
    expect(interpretModelOutput("scale", raw)).toEqual({ status: "failed", kind: "scale", code: "malformed_response" });
  });
  it("only ever produces results that fit the public schema, and none can approve anything", () => {
    for (const raw of [scaleOut(), scaleOut({ confidence: "low" }), scaleOut({ weight: null }), { junk: 1 }]) {
      const result = interpretModelOutput("scale", raw);
      expect(readingResultSchema.safeParse(result).success).toBe(true);
      expect(JSON.stringify(result)).not.toMatch(/approv/i);
    }
  });
});

describe("the Anthropic call", () => {
  const input = { kind: "scale" as const, mediaType: "image/jpeg", base64: "QUJD" };
  const toolUse = (out: unknown) => new Response(JSON.stringify({ content: [{ type: "tool_use", name: "record_reading", input: out }] }), { status: 200 });

  it("sends the image and a fixed instruction, forces structured output, and keeps the key in a header", async () => {
    const fetchMock = vi.fn(async () => toolUse(scaleOut()));
    const outcome = await createAnthropicVision(process.env, fetchMock as unknown as typeof fetch)(input);
    expect(outcome).toEqual({ ok: true, output: scaleOut() });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("sk-ant-test-key-do-not-leak");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("claude-sonnet-5-5");
    expect(body.tool_choice).toEqual({ type: "tool", name: "record_reading" });
    expect(init.body as string).not.toContain("sk-ant");
    // Minimum context: one image and one fixed sentence. No farmer, centre, price or bank data.
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].content.map((c: { type: string }) => c.type)).toEqual(["image", "text"]);
    expect(body.messages[0].content[1].text).toBe("Read the weighing scale display in this photo.");
    expect(body.system).toMatch(/never an instruction/i);
  });
  it("uses the configured model", async () => {
    process.env.ANTHROPIC_MODEL = "claude-opus-5-5";
    const fetchMock = vi.fn(async () => toolUse(scaleOut()));
    await createAnthropicVision(process.env, fetchMock as unknown as typeof fetch)(input);
    expect(JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string).model).toBe("claude-opus-5-5");
  });
  it("is not configured without a key, and makes no request", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const fetchMock = vi.fn();
    expect(await createAnthropicVision(process.env, fetchMock as unknown as typeof fetch)(input)).toEqual({ ok: false, code: "not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([
    ["a server error", new Response("boom", { status: 500 }), "api_error"],
    ["an authentication error", new Response("{}", { status: 401 }), "api_error"],
    ["a rate limit", new Response("{}", { status: 429 }), "rate_limited"],
    ["a body that is not JSON", new Response("<html>", { status: 200 }), "malformed_response"],
    ["a reply with no tool call", new Response(JSON.stringify({ content: [{ type: "text", text: "It says 860 kg" }] }), { status: 200 }), "malformed_response"],
  ])("maps %s to %s", async (_name, response, code) => {
    const fetchMock = vi.fn(async () => response);
    expect(await createAnthropicVision(process.env, fetchMock as unknown as typeof fetch)(input)).toEqual({ ok: false, code });
  });
  it("maps a network failure to api_error without leaking details", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("connect ECONNREFUSED sk-ant-test-key-do-not-leak");
    });
    expect(await createAnthropicVision(process.env, fetchMock as unknown as typeof fetch)(input)).toEqual({ ok: false, code: "api_error" });
  });
  it("gives up after the timeout", async () => {
    process.env.ANTHROPIC_TIMEOUT_MS = "1000";
    const hang = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    }));
    const started = Date.now();
    expect(await createAnthropicVision(process.env, hang as unknown as typeof fetch)(input)).toEqual({ ok: false, code: "timeout" });
    expect(Date.now() - started).toBeLessThan(5000);
  });
});

describe("reading a display end to end (library)", () => {
  it("validates the image before calling the API", async () => {
    const vision = vi.fn();
    expect(await readDisplay("scale", new Uint8Array(4096).fill(1), vision as unknown as VisionCall)).toEqual({ status: "failed", kind: "scale", code: "invalid_image" });
    expect(vision).not.toHaveBeenCalled();
  });
  it("never invents a value when the API fails", async () => {
    const vision: VisionCall = async () => ({ ok: false, code: "timeout" });
    const result = await readDisplay("moisture", jpeg(), vision);
    expect(result).toEqual({ status: "failed", kind: "moisture", code: "timeout" });
    expect(result).not.toHaveProperty("value");
  });
  it("passes a valid answer through interpretation", async () => {
    const vision: VisionCall = async () => ({ ok: true, output: moistureOut() });
    expect(await readDisplay("moisture", jpeg(), vision)).toMatchObject({ status: "ok", value: "11.4" });
  });
});

describe("POST /api/ai/read-display", () => {
  const asOperator = () => {
    const fake = fakeSupabase({ user: USER, tables: { profiles: OPERATOR_PROFILE } });
    current.client = fake.client;
    return fake;
  };
  const upload = (kind: string | null, bytes: Uint8Array | null, extra?: Record<string, string>) => {
    const form = new FormData();
    if (kind) form.set("kind", kind);
    if (bytes) form.set("image", new Blob([bytes as BlobPart], { type: "image/jpeg" }), "photo.jpg");
    for (const [k, v] of Object.entries(extra ?? {})) form.set(k, v);
    return new Request("http://localhost/api/ai/read-display", { method: "POST", body: form });
  };
  const okVision: VisionCall = async () => ({ ok: true, output: scaleOut() });

  it("refuses a signed-out request before anything else happens", async () => {
    const fake = fakeSupabase({ user: null });
    current.client = fake.client;
    const vision = vi.fn();
    const response = await handleReadDisplay(upload("scale", jpeg()), vision as unknown as VisionCall);
    expect(response.status).toBe(401);
    expect(vision).not.toHaveBeenCalled();
  });
  it("refuses an office manager, whose job does not include recording readings", async () => {
    current.client = fakeSupabase({ user: USER, tables: { profiles: MANAGER_PROFILE } }).client;
    const vision = vi.fn();
    expect((await handleReadDisplay(upload("scale", jpeg()), vision as unknown as VisionCall)).status).toBe(403);
    expect(vision).not.toHaveBeenCalled();
  });
  it("returns a suggestion for an operator, uncached, with no key in the response", async () => {
    asOperator();
    const response = await handleReadDisplay(upload("scale", jpeg()), okVision);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const text = await response.text();
    expect(JSON.parse(text).result).toMatchObject({ status: "ok", kind: "scale", value: "860.0" });
    expect(text).not.toContain("sk-ant");
  });
  it("does not approve, save or pay anything: it only talks to the vision call", async () => {
    const fake = asOperator();
    await handleReadDisplay(upload("scale", jpeg()), okVision);
    expect(fake.rpcCalls).toEqual([]);
    expect(fake.queriedTables.every((t) => t === "profiles")).toBe(true);
  });
  it("passes no farmer or other context to the provider, even if the request carries some", async () => {
    asOperator();
    const vision = vi.fn(async () => ({ ok: true as const, output: scaleOut() }));
    await handleReadDisplay(upload("scale", jpeg(), { farmerId: "x", accountNumber: "123456789012", name: "Ramesh" }), vision);
    expect(Object.keys((vision.mock.calls as unknown as [object][])[0][0]).sort()).toEqual(["base64", "kind", "mediaType"]);
  });
  it("rejects an unknown kind and a missing image", async () => {
    asOperator();
    expect((await handleReadDisplay(upload("weather", jpeg()), okVision)).status).toBe(422);
    const missing = await handleReadDisplay(upload("scale", null), okVision);
    expect(missing.status).toBe(422);
    expect((await missing.json()).result).toMatchObject({ status: "failed", code: "invalid_image" });
  });
  it("reports an unsupported or oversized upload as a failure the operator can read", async () => {
    asOperator();
    const gif = new Uint8Array(2048);
    gif.set(Buffer.from("GIF89a"));
    expect((await (await handleReadDisplay(upload("scale", gif), okVision)).json()).result).toMatchObject({ code: "unsupported_format" });
    const big = await handleReadDisplay(upload("scale", jpeg(MAX_IMAGE_BYTES + 10)), okVision);
    expect(big.status).toBe(413);
    expect((await big.json()).result).toMatchObject({ code: "too_large" });
  });
  it("reports an API failure without a value so the operator types it", async () => {
    asOperator();
    const response = await handleReadDisplay(upload("scale", jpeg()), async () => ({ ok: false, code: "api_error" }));
    const { result } = await response.json();
    expect(result).toEqual({ status: "failed", kind: "scale", code: "api_error" });
  });
  it("answers 503 with a manual-entry result when no key is configured", async () => {
    asOperator();
    delete process.env.ANTHROPIC_API_KEY;
    const response = await handleReadDisplay(upload("scale", jpeg()), okVision);
    expect(response.status).toBe(503);
    expect((await response.json()).result).toMatchObject({ status: "failed", code: "not_configured" });
  });
  it("limits how often one user can call it", async () => {
    asOperator();
    for (let i = 0; i < 20; i++) expect((await handleReadDisplay(upload("scale", jpeg()), okVision)).status).toBe(200);
    const blocked = await handleReadDisplay(upload("scale", jpeg()), okVision);
    expect(blocked.status).toBe(429);
    expect((await blocked.json()).result).toMatchObject({ code: "rate_limited" });
  });
  it("is wired to the real route, which refuses a signed-out request", async () => {
    current.client = fakeSupabase({ user: null }).client;
    expect((await readDisplayRoute(upload("scale", jpeg()))).status).toBe(401);
  });
  it("the rate limiter forgets old requests", () => {
    expect(allowRequest("u", 0, 1, 1000)).toBe(true);
    expect(allowRequest("u", 500, 1, 1000)).toBe(false);
    expect(allowRequest("u", 1500, 1, 1000)).toBe(true);
  });
});

describe("how readings are recorded with an entry", () => {
  it("accepts the three sources and nothing else", () => {
    expect(readingsSchema.safeParse({ grossKg: { source: "ai_confirmed", aiValue: "860.0", aiConfidence: "high" }, tareKg: { source: "manual" }, moisturePct: { source: "ai_corrected", aiValue: "11.4" } }).success).toBe(true);
    expect(readingsSchema.safeParse({ grossKg: { source: "ai_approved" } }).success).toBe(false);
    expect(readingsSchema.safeParse({ grossKg: { source: "manual", imageData: "abc" } }).success).toBe(false);
    expect(readingsSchema.safeParse({ farmerBank: "1234" }).success).toBe(false);
  });
});

describe("the API key stays on the server", () => {
  const files = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : /\.(ts|tsx)$/.test(e.name) ? [path.join(dir, e.name)] : []));
  const src = files(path.resolve(import.meta.dirname, ".."));

  it("is never read through a NEXT_PUBLIC_ variable", () => {
    expect(src.filter((f) => /NEXT_PUBLIC_[A-Z_]*ANTHROPIC/.test(fs.readFileSync(f, "utf8")) && !f.includes("/tests/"))).toEqual([]);
    expect(fs.readFileSync(path.resolve(import.meta.dirname, "../../.env.example"), "utf8")).not.toMatch(/NEXT_PUBLIC_ANTHROPIC/);
  });
  it("is only referenced by the server-side AI client", () => {
    const users = src.filter((f) => !f.includes("/tests/") && /ANTHROPIC_API_KEY/.test(fs.readFileSync(f, "utf8")));
    expect(users.map((f) => path.relative(path.resolve(import.meta.dirname, ".."), f))).toEqual(["lib/ai/anthropic.ts"]);
  });
  it("is not imported by anything that ships to the browser", () => {
    const clientFiles = src.filter((f) => !f.includes("/tests/") && /^\s*["']use client["']/m.test(fs.readFileSync(f, "utf8")));
    expect(clientFiles.filter((f) => /@\/lib\/ai\/(anthropic|handler|read-display|rate-limit)/.test(fs.readFileSync(f, "utf8")))).toEqual([]);
  });
  it("has the AI modules free of any approval or payment call", () => {
    for (const f of src.filter((x) => x.includes("/lib/ai/"))) {
      expect(fs.readFileSync(f, "utf8"), f).not.toMatch(/review_entry|create_payment_run|approval_status|payment_status/);
    }
  });
});
