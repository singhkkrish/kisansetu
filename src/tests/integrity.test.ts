import { describe, expect, it } from "vitest";
import {
  canonicalPayload,
  computePayloadHash,
  findChainBreak,
  isClockAhead,
  sha256Hex,
  verifyPayloadHash,
} from "@/lib/offline/integrity";
import { makeEntry } from "./helpers";

describe("sha256Hex", () => {
  it("matches a known test vector", async () => {
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("payload hash", () => {
  it("verifies an untouched entry", async () => {
    expect(await verifyPayloadHash(await makeEntry())).toBe(true);
  });

  it.each([
    ["gross weight", { grossKg: "900.0" }],
    ["moisture", { moisturePct: "10.0" }],
    ["amount", { amount: "99999.00" }],
    ["timestamp", { deviceRecordedAt: "2026-11-01T06:00:00.000Z" }],
    ["farmer", { farmerId: "44444444-4444-4444-8444-444444444444" }],
  ])("detects a changed %s", async (_name, change) => {
    const entry = await makeEntry();
    expect(await verifyPayloadHash({ ...entry, ...change })).toBe(false);
  });

  it("does not depend on key order of the input object", async () => {
    const entry = await makeEntry();
    const { payloadHash, ...rest } = entry;
    const shuffled = Object.fromEntries(Object.entries(rest).reverse()) as typeof rest;
    expect(canonicalPayload(shuffled)).toBe(canonicalPayload(rest));
    expect(await computePayloadHash(shuffled)).toBe(payloadHash);
  });
});

describe("hash chain", () => {
  it("accepts an intact chain", async () => {
    const a = await makeEntry({ slipNo: "C07-00001" });
    const b = await makeEntry({ slipNo: "C07-00002", prevHash: a.payloadHash });
    const c = await makeEntry({ slipNo: "C07-00003", prevHash: b.payloadHash });
    expect(findChainBreak([a, b, c], null)).toBe(-1);
  });

  it("reports where a deleted entry breaks the chain", async () => {
    const a = await makeEntry({ slipNo: "C07-00001" });
    const b = await makeEntry({ slipNo: "C07-00002", prevHash: a.payloadHash });
    const c = await makeEntry({ slipNo: "C07-00003", prevHash: b.payloadHash });
    expect(findChainBreak([a, c], null)).toBe(1);
  });

  it("reports re-ordered entries", async () => {
    const a = await makeEntry({ slipNo: "C07-00001" });
    const b = await makeEntry({ slipNo: "C07-00002", prevHash: a.payloadHash });
    expect(findChainBreak([b, a], null)).toBe(0);
  });
});

describe("isClockAhead", () => {
  const now = new Date("2026-11-02T10:00:00.000Z");

  it("allows entries recorded hours ago while offline", () => {
    expect(isClockAhead("2026-11-02T04:00:00.000Z", now)).toBe(false);
  });

  it("allows a few minutes of clock drift", () => {
    expect(isClockAhead("2026-11-02T10:05:00.000Z", now)).toBe(false);
  });

  it("flags entries stamped well in the future", () => {
    expect(isClockAhead("2026-11-02T10:30:00.000Z", now)).toBe(true);
  });

  it("flags unreadable timestamps", () => {
    expect(isClockAhead("not-a-date", now)).toBe(true);
  });
});
