import { describe, expect, it } from "vitest";
import { LOSS_ALERT_PCT, previewDispatch, stockOf, summariseStock, weightLoss, type StockRow } from "@/lib/stock/stock";

const row = (over: Partial<StockRow> = {}): StockRow => ({
  centreId: "c07",
  crop: "soybean",
  procuredKg: "0",
  dayKg: "0",
  dispatchedBookKg: "0",
  dispatchedWeightKg: "0",
  heldCount: 0,
  pendingPayCount: 0,
  pendingPayAmount: "0",
  failedCount: 0,
  failedAmount: "0",
  ...over,
});

describe("stock calculations", () => {
  it("is purchases minus what the stock book was relieved of", () => {
    expect(stockOf("5000.0", "1200.5")).toBe("3799.5");
    expect(stockOf("100.0", "100.0")).toBe("0.0");
  });

  it("totals procurement and stock per crop", () => {
    const s = summariseStock([
      row({ centreId: "c07", crop: "soybean", procuredKg: "5000.0", dispatchedBookKg: "1000.0", dispatchedWeightKg: "990.0" }),
      row({ centreId: "c07", crop: "tur", procuredKg: "800.0" }),
      row({ centreId: "c12", crop: "soybean", procuredKg: "3000.0" }),
      row({ centreId: "c12", crop: "tur", procuredKg: "1200.0", dispatchedBookKg: "200.0", dispatchedWeightKg: "198.0" }),
    ]);
    expect(s.totalProcuredKg).toBe("10000.0");
    expect(s.byCrop.soybean).toEqual({ procuredKg: "8000.0", stockKg: "7000.0" });
    expect(s.byCrop.tur).toEqual({ procuredKg: "2000.0", stockKg: "1800.0" });
    expect(s.totalStockKg).toBe("8800.0");
    expect(s.totalStockKg).toBe((Number(s.byCrop.soybean.stockKg) + Number(s.byCrop.tur.stockKg)).toFixed(1));
  });

  it("gives stock by centre and crop, largest first", () => {
    const s = summariseStock([
      row({ centreId: "c07", crop: "soybean", procuredKg: "5000.0", dispatchedBookKg: "1000.0" }),
      row({ centreId: "c07", crop: "tur", procuredKg: "800.0" }),
      row({ centreId: "c12", crop: "soybean", procuredKg: "3000.0" }),
    ]);
    expect(s.byCentre.map((c) => [c.centreId, c.stockKg])).toEqual([["c07", "4800.0"], ["c12", "3000.0"]]);
    expect(s.byCentre[0].byCrop).toEqual({ soybean: "4000.0", tur: "800.0" });
    expect(s.byCentre[0].procuredKg).toBe("5800.0");
  });

  it("adds up today's procurement, pending approvals, pending and failed payments", () => {
    const s = summariseStock([
      row({ dayKg: "1232.0", heldCount: 2, pendingPayCount: 3, pendingPayAmount: "100000.10", failedCount: 1, failedAmount: "2500.00" }),
      row({ crop: "tur", dayKg: "630.0", heldCount: 1, pendingPayCount: 2, pendingPayAmount: "45360.00" }),
    ]);
    expect(s.todayKg).toBe("1862.0");
    expect(s.pendingApprovals).toBe(3);
    expect(s.pendingPayments).toEqual({ count: 5, amount: "145360.10" });
    expect(s.failedPayments).toEqual({ count: 1, amount: "2500.00" });
  });

  it("copes with no data at all", () => {
    const s = summariseStock([]);
    expect(s.totalProcuredKg).toBe("0.0");
    expect(s.byCentre).toEqual([]);
    expect(s.weightLoss.lossPct).toBe("0.0");
  });

  it("adds decimal weights without drift", () => {
    const rows = Array.from({ length: 500 }, (_, i) => row({ centreId: `c${i}`, procuredKg: "0.1" }));
    expect(summariseStock(rows).totalProcuredKg).toBe("50.0");
  });
});

describe("dispatch weight loss", () => {
  it("is the stock book weight minus the weighed weight, with its percentage", () => {
    expect(weightLoss("400.0", "395.0")).toEqual({ bookKg: "400.0", weighedKg: "395.0", lossKg: "5.0", lossPct: "1.3", high: false });
  });

  it("marks a loss above the review threshold as high", () => {
    expect(LOSS_ALERT_PCT).toBe(2);
    expect(weightLoss("1000.0", "979.0").high).toBe(true);
    expect(weightLoss("1000.0", "980.0").high).toBe(false); // exactly 2% is not above it
  });

  it("is zero when nothing was lost and safe when nothing was dispatched", () => {
    expect(weightLoss("500.0", "500.0")).toMatchObject({ lossKg: "0.0", lossPct: "0.0", high: false });
    expect(weightLoss("0.0", "0.0").lossPct).toBe("0.0");
  });

  it("sums into the dashboard from all dispatches", () => {
    const s = summariseStock([
      row({ procuredKg: "5000.0", dispatchedBookKg: "1000.0", dispatchedWeightKg: "985.0" }),
      row({ centreId: "c12", procuredKg: "3000.0", dispatchedBookKg: "500.0", dispatchedWeightKg: "497.5" }),
    ]);
    expect(s.weightLoss).toMatchObject({ bookKg: "1500.0", weighedKg: "1482.5", lossKg: "17.5", lossPct: "1.2" });
  });
});

describe("dispatch preview", () => {
  it("shows stock before and after, and the loss", () => {
    expect(previewDispatch("4800.0", "400.0", "395.0")).toMatchObject({
      stockBeforeKg: "4800.0",
      stockAfterKg: "4400.0",
      enoughStock: true,
      loss: { lossKg: "5.0" },
    });
  });

  it("flags a dispatch larger than the stock", () => {
    const p = previewDispatch("100.0", "150.0", "149.0");
    expect(p.enoughStock).toBe(false);
    expect(p.stockAfterKg).toBe("-50.0");
  });

  it("allows taking exactly all of the stock", () => {
    expect(previewDispatch("100.0", "100.0", "99.0")).toMatchObject({ enoughStock: true, stockAfterKg: "0.0" });
  });
});
