import { describe, expect, it } from "vitest";
import {
  BANK_COLUMNS,
  DEFAULT_BANK_FILE_CONFIG,
  buildBankFile,
  csvField,
  loadBankFileConfig,
  type BankFileRow,
} from "@/lib/payments/bank-file";
import { groupByFarmer, sumAmounts, type PayableEntry } from "@/lib/payments/grouping";
import { cancelRunSchema, createRunSchema, dispatchSchema, simulateSchema } from "@/lib/payments/schemas";

const CENTRE = "22222222-2222-4222-8222-222222222222";
const bank = (n: string, verified = true) => ({ holderName: `Holder ${n}`, accountNumber: `50461860838${n}888`, ifsc: "SBIN0012874", verified });

let seq = 0;
const entry = (farmerId: string, amount: string, over: Partial<PayableEntry> = {}): PayableEntry => ({
  id: `e${++seq}`,
  slipNo: `C07-${24500 + seq}`,
  farmerId,
  farmerCode: `FM${farmerId.padStart(5, "0")}`,
  farmerName: `Farmer ${farmerId}`,
  centreId: CENTRE,
  amount,
  bank: bank(farmerId),
  ...over,
});

describe("payment grouping", () => {
  it("groups purchases by farmer and counts their entries", () => {
    const { groups } = groupByFarmer([entry("1", "100.00"), entry("2", "50.00"), entry("1", "25.50")]);
    expect(groups.map((g) => [g.farmerId, g.entryCount, g.amount])).toEqual([
      ["1", 2, "125.50"],
      ["2", 1, "50.00"],
    ]);
  });

  it("keeps every entry id with its farmer", () => {
    const a = entry("1", "10.00");
    const b = entry("1", "20.00");
    const { groups } = groupByFarmer([a, entry("2", "5.00"), b]);
    expect(groups.find((g) => g.farmerId === "1")?.entryIds).toEqual([a.id, b.id]);
  });

  it("sorts farmers by their member id so the list is stable", () => {
    const { groups } = groupByFarmer([entry("9", "1.00"), entry("3", "1.00"), entry("5", "1.00")]);
    expect(groups.map((g) => g.farmerId)).toEqual(["3", "5", "9"]);
  });

  it("masks the account number to its last four digits", () => {
    const { groups } = groupByFarmer([entry("1", "10.00")]);
    expect(groups[0].accountMasked).toMatch(/^X+\d{4}$/);
    expect(groups[0].accountMasked).toHaveLength(15);
    expect(JSON.stringify(groups)).not.toContain("50461860838");
  });

  it("separates farmers who cannot be paid, with the reason, and does not count them as payable", () => {
    const preview = groupByFarmer([
      entry("1", "100.00"),
      entry("2", "40.00", { bank: null }),
      entry("2", "10.00", { bank: null }),
      entry("3", "70.00", { bank: bank("3", false) }),
    ]);
    expect(preview.payable).toEqual({ farmers: 1, entries: 1, amount: "100.00" });
    expect(preview.blocked).toEqual([
      expect.objectContaining({ farmerId: "2", reason: "no_bank", entryCount: 2, amount: "50.00" }),
      expect.objectContaining({ farmerId: "3", reason: "bank_unverified", entryCount: 1, amount: "70.00" }),
    ]);
    expect(preview.blockedTotals).toEqual({ farmers: 2, entries: 3, amount: "120.00" });
  });

  it("handles an empty selection", () => {
    expect(groupByFarmer([])).toMatchObject({ groups: [], blocked: [], payable: { farmers: 0, entries: 0, amount: "0.00" } });
  });
});

describe("payment totals", () => {
  it("adds money as exact decimals, with no floating-point drift", () => {
    // 0.1 + 0.2 and many small amounts drift in floating point.
    expect(sumAmounts(["0.10", "0.20"])).toBe("0.30");
    const many = Array.from({ length: 1000 }, () => "0.10");
    expect(sumAmounts(many)).toBe("100.00");
    const preview = groupByFarmer(Array.from({ length: 300 }, () => entry("1", "19.99")));
    expect(preview.payable.amount).toBe("5997.00");
  });

  it("makes the run total equal the sum of the farmer totals", () => {
    const entries = [entry("1", "59752.00"), entry("2", "40303.50"), entry("1", "45360.00"), entry("3", "0.01")];
    const preview = groupByFarmer(entries);
    expect(preview.payable.amount).toBe(sumAmounts(preview.groups.map((g) => g.amount)));
    expect(preview.payable.amount).toBe("145415.51");
    expect(preview.payable.entries).toBe(entries.length);
  });
});

const row = (n: number, over: Partial<BankFileRow> = {}): BankFileRow => ({
  beneficiaryName: `Farmer ${n}`,
  accountNumber: `50461860838788${n}`,
  ifsc: "SBIN0012874",
  amount: `${n}00.5`,
  paymentRef: `PR-20261105-001-00${n}`,
  runNo: "PR-20261105-001",
  farmerCode: `FM0010${n}`,
  ...over,
});

describe("mock bank CSV", () => {
  it("writes the documented default columns with a header, CRLF lines and two-decimal amounts", () => {
    const file = buildBankFile([row(1), row(2)]);
    expect(file.content).toBe(
      [
        "beneficiary_name,account_number,ifsc,amount,payment_ref,payment_run_id",
        "Farmer 1,504618608387881,SBIN0012874,100.50,PR-20261105-001-001,PR-20261105-001",
        "Farmer 2,504618608387882,SBIN0012874,200.50,PR-20261105-001-002,PR-20261105-001",
        "",
      ].join("\r\n"),
    );
    expect(file.rowCount).toBe(2);
    expect(file.total).toBe("301.00");
  });

  it("includes every field the brief asks for", () => {
    for (const c of ["beneficiary_name", "account_number", "ifsc", "amount", "payment_ref", "payment_run_id"] as const) {
      expect(DEFAULT_BANK_FILE_CONFIG.columns).toContain(c);
    }
  });

  it("orders rows by payment reference so the same run gives the same file", () => {
    const a = buildBankFile([row(3), row(1), row(2)]).content;
    const b = buildBankFile([row(2), row(3), row(1)]).content;
    expect(a).toBe(b);
  });

  it("gives every row a unique payment reference when the run does", () => {
    const refs = buildBankFile([row(1), row(2), row(3)]).content.split("\r\n").slice(1, 4).map((l) => l.split(",")[4]);
    expect(new Set(refs).size).toBe(3);
  });

  it("is configurable: columns, delimiter and header", () => {
    const config = { columns: ["payment_ref", "amount", "ifsc"] as const, delimiter: "|" as const, includeHeader: false };
    expect(buildBankFile([row(1)], config).content).toBe("PR-20261105-001-001|100.50|SBIN0012874\r\n");
  });

  it("reads its layout from the environment and ignores bad values", () => {
    expect(loadBankFileConfig({ BANK_FILE_COLUMNS: "ifsc, amount", BANK_FILE_DELIMITER: "pipe", BANK_FILE_HEADER: "false" }))
      .toEqual({ columns: ["ifsc", "amount"], delimiter: "|", includeHeader: false });
    expect(loadBankFileConfig({})).toEqual(DEFAULT_BANK_FILE_CONFIG);
    expect(loadBankFileConfig({ BANK_FILE_COLUMNS: "ifsc,password" }).columns).toEqual(DEFAULT_BANK_FILE_CONFIG.columns);
    expect(loadBankFileConfig({ BANK_FILE_COLUMNS: "ifsc,ifsc" }).columns).toEqual(DEFAULT_BANK_FILE_CONFIG.columns);
    expect(loadBankFileConfig({ BANK_FILE_DELIMITER: "bell" }).delimiter).toBe(",");
  });

  it("offers every column the documentation lists", () => {
    expect([...BANK_COLUMNS]).toEqual(["beneficiary_name", "account_number", "ifsc", "amount", "payment_ref", "payment_run_id", "farmer_id"]);
  });

  it("quotes fields that contain the delimiter, quotes or line breaks", () => {
    expect(csvField("Patil, Ramesh", ",")).toBe('"Patil, Ramesh"');
    expect(csvField('Say "hi"', ",")).toBe('"Say ""hi"""');
    expect(csvField("two\nlines", ",")).toBe('"two\nlines"');
    expect(csvField("a;b", ";")).toBe('"a;b"');
    expect(csvField("a;b", ",")).toBe("a;b");
  });

  it("neutralises values a spreadsheet would run as a formula", () => {
    expect(csvField("=SUM(A1)", ",")).toBe("'=SUM(A1)");
    expect(csvField("+91 99", ",")).toBe("'+91 99");
    expect(csvField("@cmd", ",")).toBe("'@cmd");
    expect(csvField("-5", ",")).toBe("'-5");
    expect(csvField("Ramesh Patil", ",")).toBe("Ramesh Patil");
  });

  it("keeps Marathi names intact", () => {
    expect(buildBankFile([row(1, { beneficiaryName: "रमेश पाटील" })]).content).toContain("रमेश पाटील,");
  });

  it("writes a header only for an empty run when asked", () => {
    expect(buildBankFile([]).content).toBe("beneficiary_name,account_number,ifsc,amount,payment_ref,payment_run_id\r\n");
    expect(buildBankFile([]).total).toBe("0.00");
  });
});

describe("request validation", () => {
  const id = "22222222-2222-4222-8222-222222222222";

  it("accepts a sensible run request and rejects reversed dates or no centres", () => {
    expect(createRunSchema.safeParse({ from: "2026-11-01", to: "2026-11-05", centreIds: [id] }).success).toBe(true);
    expect(createRunSchema.safeParse({ from: "2026-11-05", to: "2026-11-01", centreIds: [id] }).success).toBe(false);
    expect(createRunSchema.safeParse({ from: "2026-11-01", to: "2026-11-05", centreIds: [] }).success).toBe(false);
    expect(createRunSchema.safeParse({ from: "2026-11-01", to: "2026-11-05", centreIds: [id], amount: "1" }).success).toBe(false);
  });

  it("needs a reason to fail a payment but not to pay one", () => {
    expect(simulateSchema.safeParse({ itemIds: [id], outcome: "paid" }).success).toBe(true);
    expect(simulateSchema.safeParse({ itemIds: [id], outcome: "failed" }).success).toBe(false);
    expect(simulateSchema.safeParse({ itemIds: [id], outcome: "failed", reason: "Account closed" }).success).toBe(true);
    expect(simulateSchema.safeParse({ itemIds: [id], outcome: "delivered" }).success).toBe(false);
  });

  it("needs a reason to cancel a run", () => {
    expect(cancelRunSchema.safeParse({ reason: "ok" }).success).toBe(false);
    expect(cancelRunSchema.safeParse({ reason: "Wrong dates chosen" }).success).toBe(true);
  });

  it("normalises the truck number and limits weights to one decimal", () => {
    const base = { centreId: id, crop: "soybean", weightKg: "395.5", destination: "Latur APMC", truckNo: "mh 24-ab 1234" };
    const ok = dispatchSchema.parse(base);
    expect(ok.truckNo).toBe("MH24AB1234");
    expect(dispatchSchema.safeParse({ ...base, weightKg: "395.55" }).success).toBe(false);
    expect(dispatchSchema.safeParse({ ...base, weightKg: "0" }).success).toBe(false);
    expect(dispatchSchema.safeParse({ ...base, weightKg: "-5" }).success).toBe(false);
    expect(dispatchSchema.safeParse({ ...base, truckNo: "X1" }).success).toBe(false);
    expect(dispatchSchema.safeParse({ ...base, crop: "wheat" }).success).toBe(false);
  });
});
