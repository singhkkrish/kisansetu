import { describe, expect, it } from "vitest";
import {
  MAX_DAYS_AHEAD,
  addDays,
  buildBoard,
  effectiveDateProblem,
  isEditable,
  pendingDrafts,
  priceRate,
  publishSchema,
  saveDraftsSchema,
  slotState,
  updateDraftSchema,
  type PriceVersion,
} from "@/lib/prices/price-board";

const TODAY = "2026-11-04";

describe("price effective dates", () => {
  it("accepts today and every day up to the limit ahead", () => {
    expect(effectiveDateProblem(TODAY, TODAY)).toBeNull();
    expect(effectiveDateProblem("2026-11-05", TODAY)).toBeNull();
    expect(effectiveDateProblem(addDays(TODAY, MAX_DAYS_AHEAD), TODAY)).toBeNull();
  });

  it("refuses a past date, so a price can never be backdated", () => {
    expect(effectiveDateProblem("2026-11-03", TODAY)).toBe("past");
    expect(effectiveDateProblem("2025-01-01", TODAY)).toBe("past");
  });

  it("refuses a date beyond the limit", () => {
    expect(effectiveDateProblem(addDays(TODAY, MAX_DAYS_AHEAD + 1), TODAY)).toBe("too_far");
  });

  it("refuses text and dates that do not exist", () => {
    for (const bad of ["", "tomorrow", "2026-13-01", "2026-02-30", "04-11-2026", "2026-11-4"]) {
      expect(effectiveDateProblem(bad, TODAY)).toBe("invalid");
    }
  });

  it("counts days across month and year ends", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-11-04", 14)).toBe("2026-11-18");
  });

  it("judges the date by India's today, which is the caller's to supply", () => {
    // 23:30 UTC on the 4th is already the 5th in India.
    const istToday = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date("2026-11-04T23:30:00Z"));
    expect(istToday).toBe("2026-11-05");
    expect(effectiveDateProblem("2026-11-04", istToday)).toBe("past");
  });
});

describe("price input validation", () => {
  it.each(["4850", "4850.5", "4850.50", "1", "99999.99"])("accepts rate %s", (rate) => {
    expect(priceRate.safeParse(rate).success).toBe(true);
  });

  it("accepts a number and keeps it as exact text", () => {
    expect(priceRate.parse(4850.5)).toBe("4850.5");
  });

  it.each(["0", "0.00", "-5", "4850.555", "abc", "", "100000", "1e3"])("refuses rate %s", (rate) => {
    expect(priceRate.safeParse(rate).success).toBe(false);
  });

  it("saves a board only with real rows and a real date", () => {
    const row = { crop: "soybean", grade: "A", rate: "4850" };
    expect(saveDraftsSchema.safeParse({ date: TODAY, rows: [row] }).success).toBe(true);
    expect(saveDraftsSchema.safeParse({ date: TODAY, rows: [] }).success).toBe(false);
    expect(saveDraftsSchema.safeParse({ date: "2026-02-30", rows: [row] }).success).toBe(false);
    expect(saveDraftsSchema.safeParse({ date: TODAY, rows: [{ ...row, crop: "wheat" }] }).success).toBe(false);
    expect(saveDraftsSchema.safeParse({ date: TODAY, rows: [{ ...row, grade: "Z" }] }).success).toBe(false);
  });

  it("rejects unexpected keys instead of ignoring them", () => {
    const row = { crop: "tur", grade: "A", rate: "7200" };
    expect(saveDraftsSchema.safeParse({ date: TODAY, rows: [row], status: "published" }).success).toBe(false);
    expect(saveDraftsSchema.safeParse({ date: TODAY, rows: [{ ...row, publishedBy: "x" }] }).success).toBe(false);
    expect(updateDraftSchema.safeParse({ rate: "100", status: "published" }).success).toBe(false);
  });

  it("publishes only with explicit confirmation", () => {
    const ids = ["11111111-1111-4111-8111-111111111111"];
    expect(publishSchema.safeParse({ ids, confirm: true }).success).toBe(true);
    expect(publishSchema.safeParse({ ids }).success).toBe(false);
    expect(publishSchema.safeParse({ ids, confirm: false }).success).toBe(false);
    expect(publishSchema.safeParse({ ids, confirm: "true" }).success).toBe(false);
    expect(publishSchema.safeParse({ ids: [], confirm: true }).success).toBe(false);
    expect(publishSchema.safeParse({ ids: ["nope"], confirm: true }).success).toBe(false);
  });
});

function version(over: Partial<PriceVersion>): PriceVersion {
  return {
    id: crypto.randomUUID(), priceDate: TODAY, crop: "soybean", grade: "A", version: 1, rate: "4850.00",
    status: "published", createdByName: "Office Manager", createdAt: "2026-11-04T04:00:00Z",
    publishedByName: "Office Manager", publishedAt: "2026-11-04T04:05:00Z", correctionReason: null, ...over,
  };
}

describe("price board", () => {
  it("lays out every crop and grade for the chosen date", () => {
    const board = buildBoard([], TODAY);
    expect(board).toHaveLength(6);
    expect(board.every((s) => slotState(s) === "empty")).toBe(true);
  });

  it("tells drafts, published prices and corrections apart", () => {
    const board = buildBoard(
      [
        version({ crop: "soybean", grade: "A" }),
        version({ crop: "soybean", grade: "B", status: "draft", version: 1, publishedAt: null, publishedByName: null }),
        version({ crop: "tur", grade: "A", version: 1, status: "superseded" }),
        version({ crop: "tur", grade: "A", version: 2, status: "published", correctionReason: "Market moved" }),
        version({ crop: "tur", grade: "A", version: 3, status: "draft", publishedAt: null, publishedByName: null }),
        version({ priceDate: "2026-11-05", crop: "tur", grade: "B" }),
      ],
      TODAY,
    );
    const state = (c: string, g: string) => slotState(board.find((s) => s.crop === c && s.grade === g)!);
    expect(state("soybean", "A")).toBe("published");
    expect(state("soybean", "B")).toBe("draft");
    expect(state("tur", "A")).toBe("correction");
    expect(state("tur", "B")).toBe("empty"); // that price is for another date
    expect(pendingDrafts(board)).toHaveLength(2);
    expect(board.find((s) => s.crop === "tur" && s.grade === "A")!.published!.version).toBe(2);
  });

  it("allows editing only unpublished prices", () => {
    expect(isEditable("draft")).toBe(true);
    expect(isEditable("published")).toBe(false);
    expect(isEditable("superseded")).toBe(false);
  });
});
