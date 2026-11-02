import { describe, expect, it } from "vitest";
import {
  accountNumberSchema,
  bankDetailsSchema,
  bankUpdateSchema,
  ifscSchema,
  maskAccountNumber,
} from "@/lib/validation/bank";
import {
  issuesToFieldErrors,
  memberCreateSchema,
  memberUpdateSchema,
  toFarmerPayload,
} from "@/lib/validation/member";

const CENTRE = "22222222-2222-4222-8222-222222222222";

const validCreate = {
  fullName: "Sunil Jadhav",
  village: "Ganjur",
  centreId: CENTRE,
  phone: "9000000101",
  landAcres: "14.50",
  crops: ["soybean", "tur"],
  consentConfirmed: true,
  bank: { holderName: "Sunil Jadhav", accountNumber: "504618608387888", ifsc: "SBIN0012874" },
};

function errorsFor(input: unknown, schema = memberCreateSchema) {
  const result = schema.safeParse(input);
  return result.success ? null : issuesToFieldErrors(result.error);
}

describe("farmer validation", () => {
  it("accepts a complete, valid farmer", () => {
    const result = memberCreateSchema.safeParse(validCreate);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.active).toBe(true);
  });

  it("accepts Marathi names and villages", () => {
    const result = memberCreateSchema.safeParse({ ...validCreate, fullName: "सुनील जाधव", village: "गंजूर" });
    expect(result.success).toBe(true);
  });

  it.each([
    ["too short", "A"],
    ["digits", "Sunil 123"],
    ["markup", "<script>alert(1)</script>"],
    ["empty", "   "],
  ])("rejects a name that is %s", (_label, fullName) => {
    expect(errorsFor({ ...validCreate, fullName })).toHaveProperty("fullName");
  });

  it("requires a village and a real centre id", () => {
    expect(errorsFor({ ...validCreate, village: "" })).toHaveProperty("village");
    expect(errorsFor({ ...validCreate, centreId: "C07" })).toHaveProperty("centreId");
  });

  describe("phone", () => {
    it("is optional and becomes null when empty or missing", () => {
      const empty = memberCreateSchema.parse({ ...validCreate, phone: "" });
      expect(empty.phone).toBeNull();
      const { phone: _omitted, ...withoutPhone } = validCreate;
      expect(memberCreateSchema.parse(withoutPhone).phone).toBeNull();
    });

    it.each(["+91 90000 00101", "09000000101", "90000-00101"])("normalises %s", (input) => {
      expect(memberCreateSchema.parse({ ...validCreate, phone: input }).phone).toBe("9000000101");
    });

    it.each(["12345", "5000000101", "90000001012", "phone"])("rejects %s", (phone) => {
      expect(errorsFor({ ...validCreate, phone })).toHaveProperty("phone");
    });
  });

  describe("land area", () => {
    it("accepts numbers and strings", () => {
      expect(memberCreateSchema.parse({ ...validCreate, landAcres: 12 }).landAcres).toBe("12");
      expect(memberCreateSchema.parse({ ...validCreate, landAcres: " 3.25 " }).landAcres).toBe("3.25");
    });

    it.each(["0", "0.00", "-4", "501", "1.234", "abc", ""])("rejects %s", (landAcres) => {
      expect(errorsFor({ ...validCreate, landAcres })).toHaveProperty("landAcres");
    });
  });

  describe("crop eligibility", () => {
    it("needs at least one known crop, listed once", () => {
      expect(errorsFor({ ...validCreate, crops: [] })).toHaveProperty("crops");
      expect(errorsFor({ ...validCreate, crops: ["wheat"] })).toBeTruthy();
      expect(errorsFor({ ...validCreate, crops: ["tur", "tur"] })).toHaveProperty("crops");
    });
  });

  describe("consent (DPDP Act 2023)", () => {
    it("must be confirmed to register a farmer", () => {
      expect(errorsFor({ ...validCreate, consentConfirmed: false })).toHaveProperty("consentConfirmed");
      const { consentConfirmed: _omitted, ...without } = validCreate;
      expect(errorsFor(without)).toHaveProperty("consentConfirmed");
    });
  });

  describe("no Aadhaar numbers", () => {
    it.each(["aadhaar", "aadhaarNumber", "aadhar", "uid"])("rejects a %s field", (key) => {
      expect(memberCreateSchema.safeParse({ ...validCreate, [key]: "234567890123" }).success).toBe(false);
      expect(memberUpdateSchema.safeParse({ ...validCreate, consentConfirmed: undefined, [key]: "234567890123" }).success).toBe(false);
    });

    it("also rejects it nested inside bank details", () => {
      const bank = { ...validCreate.bank, aadhaar: "234567890123" };
      expect(memberCreateSchema.safeParse({ ...validCreate, bank }).success).toBe(false);
    });

    it("never forwards unknown fields to the database payload", () => {
      const payload = toFarmerPayload(memberCreateSchema.parse(validCreate));
      expect(JSON.stringify(payload)).not.toMatch(/aadhaar|aadhar/i);
    });
  });

  it("builds the database payload in snake case with a normalised bank block", () => {
    const parsed = memberCreateSchema.parse({
      ...validCreate,
      bank: { holderName: " Sunil Jadhav ", accountNumber: "5046 1860 8387 888", ifsc: "sbin0012874" },
    });
    expect(toFarmerPayload(parsed)).toEqual({
      full_name: "Sunil Jadhav",
      village: "Ganjur",
      centre_id: CENTRE,
      phone: "9000000101",
      land_acres: "14.50",
      crops: ["soybean", "tur"],
      active: true,
      bank: { holder_name: "Sunil Jadhav", account_number: "504618608387888", ifsc: "SBIN0012874" },
    });
  });

  it("allows registering without bank details", () => {
    const { bank: _omitted, ...withoutBank } = validCreate;
    const parsed = memberCreateSchema.parse(withoutBank);
    expect(toFarmerPayload(parsed)).not.toHaveProperty("bank");
  });
});

describe("invalid bank details", () => {
  describe("IFSC", () => {
    it("is upper-cased and trimmed", () => {
      expect(ifscSchema.parse("  sbin0012874 ")).toBe("SBIN0012874");
    });

    it.each([
      ["too short", "SBIN001287"],
      ["too long", "SBIN00128745"],
      ["fifth character not zero", "SBIN1012874"],
      ["digits in the bank code", "SB1N0012874"],
      ["symbols", "SBIN00128-4"],
      ["empty", ""],
    ])("rejects an IFSC that is %s", (_label, ifsc) => {
      expect(ifscSchema.safeParse(ifsc).success).toBe(false);
    });
  });

  describe("account number", () => {
    it("drops spaces and dashes", () => {
      expect(accountNumberSchema.parse("1234-5678 9012")).toBe("123456789012");
    });

    it.each([
      ["too short", "12345678"],
      ["too long", "1234567890123456789"],
      ["letters", "1234ABCD5678"],
      ["one repeated digit", "000000000000"],
      ["empty", ""],
    ])("rejects an account number that is %s", (_label, value) => {
      expect(accountNumberSchema.safeParse(value).success).toBe(false);
    });
  });

  it("requires all three fields for a new account", () => {
    expect(bankDetailsSchema.safeParse({ holderName: "Sunil Jadhav", ifsc: "SBIN0012874" }).success).toBe(false);
    expect(bankDetailsSchema.safeParse({ accountNumber: "123456789012", ifsc: "SBIN0012874" }).success).toBe(false);
    expect(bankDetailsSchema.safeParse({ holderName: "Sunil Jadhav", accountNumber: "123456789012" }).success).toBe(false);
  });

  it("reports the failing bank field by path", () => {
    const errors = errorsFor({ ...validCreate, bank: { holderName: "S", accountNumber: "12", ifsc: "bad" } });
    expect(errors).toMatchObject({
      "bank.holderName": expect.any(String),
      "bank.accountNumber": expect.any(String),
      "bank.ifsc": expect.any(String),
    });
  });

  it("lets an edit leave the account number empty to keep the stored one", () => {
    const kept = bankUpdateSchema.parse({ holderName: "Sunil Jadhav", accountNumber: "", ifsc: "SBIN0012874" });
    expect(kept.accountNumber).toBeUndefined();
    const omitted = bankUpdateSchema.parse({ holderName: "Sunil Jadhav", ifsc: "SBIN0012874" });
    expect(omitted.accountNumber).toBeUndefined();
  });

  it("still validates a new account number supplied during an edit", () => {
    expect(bankUpdateSchema.safeParse({ holderName: "Sunil Jadhav", accountNumber: "12", ifsc: "SBIN0012874" }).success).toBe(false);
    expect(bankUpdateSchema.parse({ holderName: "Sunil Jadhav", accountNumber: "9999 8888 7777", ifsc: "SBIN0012874" }).accountNumber).toBe("999988887777");
  });

  it("validates edits the same way as new farmers, without needing consent again", () => {
    const { consentConfirmed: _omitted, ...update } = validCreate;
    expect(memberUpdateSchema.safeParse(update).success).toBe(true);
    expect(memberUpdateSchema.safeParse({ ...update, crops: [] }).success).toBe(false);
  });
});

describe("maskAccountNumber", () => {
  it("shows only the last four digits", () => {
    expect(maskAccountNumber("504618608387888")).toBe("XXXXXXXXXXX7888");
    expect(maskAccountNumber("123456789012")).toBe("XXXXXXXX9012");
  });

  it("keeps the length so the number looks like an account number", () => {
    expect(maskAccountNumber("123456789012")).toHaveLength(12);
  });

  it("never reveals a short value", () => {
    expect(maskAccountNumber("1234")).toBe("XXXX");
    expect(maskAccountNumber("12")).toBe("XX");
    expect(maskAccountNumber("")).toBe("");
  });

  it("does not leak the original number", () => {
    expect(maskAccountNumber("504618608387888")).not.toContain("5046");
  });
});
