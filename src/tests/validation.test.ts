import { describe, expect, it } from "vitest";
import {
  entryRecordSchema,
  procurementInputSchema,
  syncRequestSchema,
  MAX_SYNC_BATCH,
} from "@/lib/validation/procurement";
import { IDS, makeEntry } from "./helpers";

const validInput = {
  farmerId: IDS.farmer,
  crop: "soybean",
  grade: "A",
  grossKg: "1250.0",
  tareKg: "18.0",
  moisturePct: "11.5",
  ratePerQuintal: "4850",
};

describe("procurementInputSchema", () => {
  it("accepts a valid entry and normalises numbers to strings", () => {
    const parsed = procurementInputSchema.parse({ ...validInput, grossKg: 1250, tareKg: 18 });
    expect(parsed.grossKg).toBe("1250");
    expect(parsed.tareKg).toBe("18");
  });

  it("rejects tare that is not below gross", () => {
    const result = procurementInputSchema.safeParse({ ...validInput, tareKg: "1250.0" });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown crop", () => {
    expect(procurementInputSchema.safeParse({ ...validInput, crop: "wheat" }).success).toBe(false);
  });

  it("rejects a farmer id that is not a uuid", () => {
    expect(procurementInputSchema.safeParse({ ...validInput, farmerId: "abc" }).success).toBe(false);
  });
});

describe("entryRecordSchema", () => {
  it("accepts a correctly derived entry", async () => {
    expect(entryRecordSchema.safeParse(await makeEntry()).success).toBe(true);
  });

  it("rejects a net weight that ignores the moisture rule", async () => {
    const bad = await makeEntry({ netKg: "848.0" });
    const result = entryRecordSchema.safeParse(bad);
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((i) => i.path[0] === "netKg")).toBe(true);
  });

  it("rejects an inflated amount", async () => {
    const bad = await makeEntry({ amount: "50000.00" });
    const result = entryRecordSchema.safeParse(bad);
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((i) => i.path[0] === "amount")).toBe(true);
  });

  it("rejects a malformed slip number", async () => {
    const bad = await makeEntry({ slipNo: "24518" });
    expect(entryRecordSchema.safeParse(bad).success).toBe(false);
  });
});

describe("syncRequestSchema", () => {
  it("requires at least one entry", () => {
    expect(syncRequestSchema.safeParse({ deviceId: "dev-test-device-0001", entries: [] }).success).toBe(false);
  });

  it("caps the batch size", () => {
    const entries = Array.from({ length: MAX_SYNC_BATCH + 1 }, () => ({}));
    expect(syncRequestSchema.safeParse({ deviceId: "dev-test-device-0001", entries }).success).toBe(false);
  });
});
