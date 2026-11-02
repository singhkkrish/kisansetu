import { calculateProcurement } from "@/lib/calculations/procurement";
import { computePayloadHash } from "@/lib/offline/integrity";
import type { EntryRecord } from "@/lib/validation/procurement";

export const IDS = {
  farmer: "11111111-1111-4111-8111-111111111111",
  centre: "22222222-2222-4222-8222-222222222222",
  operator: "33333333-3333-4333-8333-333333333333",
} as const;

export const DEVICE_ID = "dev-test-device-0001";

/** Builds a correctly derived and hashed entry. Override fields to break it. */
export async function makeEntry(overrides: Partial<EntryRecord> = {}): Promise<EntryRecord> {
  const base = {
    clientId: crypto.randomUUID(),
    slipNo: "C07-00001",
    farmerId: IDS.farmer,
    centreId: IDS.centre,
    operatorId: IDS.operator,
    crop: "soybean" as const,
    grade: "A" as const,
    grossKg: "860.0",
    tareKg: "12.0",
    moisturePct: "14.0",
    ratePerQuintal: "4850",
    deviceId: DEVICE_ID,
    deviceRecordedAt: "2026-11-02T06:00:00.000Z",
    prevHash: null as string | null,
    ...overrides,
  };
  const calc = calculateProcurement(base);
  const unsigned = {
    ...base,
    netKg: overrides.netKg ?? calc.netKg,
    amount: overrides.amount ?? calc.amount,
  };
  const payloadHash = overrides.payloadHash ?? (await computePayloadHash(unsigned));
  return { ...unsigned, payloadHash };
}
