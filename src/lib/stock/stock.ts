import Decimal from "decimal.js";
import type { Crop } from "@/types/domain";

/** One row of the database's stock_summary(): a centre and a crop. Weights are kg strings. */
export interface StockRow {
  centreId: string;
  crop: Crop;
  procuredKg: string;
  dayKg: string;
  dispatchedBookKg: string;
  dispatchedWeightKg: string;
  heldCount: number;
  pendingPayCount: number;
  pendingPayAmount: string;
  failedCount: number;
  failedAmount: string;
}

export interface StockSummary {
  totalProcuredKg: string;
  totalStockKg: string;
  todayKg: string;
  byCrop: Record<Crop, { procuredKg: string; stockKg: string }>;
  byCentre: { centreId: string; stockKg: string; procuredKg: string; byCrop: Record<Crop, string> }[];
  pendingApprovals: number;
  pendingPayments: { count: number; amount: string };
  failedPayments: { count: number; amount: string };
  weightLoss: WeightLoss;
}

const kg = (d: Decimal) => d.toFixed(1);
const money = (d: Decimal) => d.toFixed(2);
const zeroCrops = (): Record<Crop, Decimal> => ({ soybean: new Decimal(0), tur: new Decimal(0) });

/**
 * Stock of one centre and crop: what was bought (purchases that still stand)
 * minus what the stock book was relieved of by dispatches. Never negative on
 * valid data, because a dispatch cannot take more than the stock.
 */
export function stockOf(procuredKg: string, dispatchedBookKg: string): string {
  return kg(new Decimal(procuredKg).minus(dispatchedBookKg));
}

/** Combines the per-centre, per-crop rows into the figures the dashboard shows. */
export function summariseStock(rows: readonly StockRow[]): StockSummary {
  let procured = new Decimal(0);
  let today = new Decimal(0);
  let dispatchedBook = new Decimal(0);
  let dispatchedWeight = new Decimal(0);
  const crop = { soybean: { procured: new Decimal(0), stock: new Decimal(0) }, tur: { procured: new Decimal(0), stock: new Decimal(0) } };
  const centres = new Map<string, { procured: Decimal; stock: Decimal; byCrop: Record<Crop, Decimal> }>();
  let held = 0;
  let payN = 0;
  let payAmt = new Decimal(0);
  let failN = 0;
  let failAmt = new Decimal(0);

  for (const r of rows) {
    const p = new Decimal(r.procuredKg);
    const stock = p.minus(r.dispatchedBookKg);
    procured = procured.plus(p);
    today = today.plus(r.dayKg);
    dispatchedBook = dispatchedBook.plus(r.dispatchedBookKg);
    dispatchedWeight = dispatchedWeight.plus(r.dispatchedWeightKg);
    crop[r.crop].procured = crop[r.crop].procured.plus(p);
    crop[r.crop].stock = crop[r.crop].stock.plus(stock);

    const c = centres.get(r.centreId) ?? { procured: new Decimal(0), stock: new Decimal(0), byCrop: zeroCrops() };
    c.procured = c.procured.plus(p);
    c.stock = c.stock.plus(stock);
    c.byCrop[r.crop] = c.byCrop[r.crop].plus(stock);
    centres.set(r.centreId, c);

    held += r.heldCount;
    payN += r.pendingPayCount;
    payAmt = payAmt.plus(r.pendingPayAmount);
    failN += r.failedCount;
    failAmt = failAmt.plus(r.failedAmount);
  }

  return {
    totalProcuredKg: kg(procured),
    totalStockKg: kg(procured.minus(dispatchedBook)),
    todayKg: kg(today),
    byCrop: {
      soybean: { procuredKg: kg(crop.soybean.procured), stockKg: kg(crop.soybean.stock) },
      tur: { procuredKg: kg(crop.tur.procured), stockKg: kg(crop.tur.stock) },
    },
    byCentre: [...centres.entries()]
      .map(([centreId, c]) => ({
        centreId,
        stockKg: kg(c.stock),
        procuredKg: kg(c.procured),
        byCrop: { soybean: kg(c.byCrop.soybean), tur: kg(c.byCrop.tur) },
      }))
      .sort((a, b) => Number(b.stockKg) - Number(a.stockKg)),
    pendingApprovals: held,
    pendingPayments: { count: payN, amount: money(payAmt) },
    failedPayments: { count: failN, amount: money(failAmt) },
    weightLoss: weightLoss(kg(dispatchedBook), kg(dispatchedWeight)),
  };
}

/** A loss above this share of the stock sent is shown as high. A review threshold, not a rule. */
export const LOSS_ALERT_PCT = 2;

export interface WeightLoss {
  bookKg: string;
  weighedKg: string;
  lossKg: string;
  /** Percent of the book quantity, one decimal. "0.0" when nothing was dispatched. */
  lossPct: string;
  high: boolean;
}

/**
 * Weight lost between the centre's stock book and the truck's weighed weight.
 * The stock book carries the weight recorded when the produce was bought; the
 * truck is weighed at dispatch. The difference is handling and drying loss.
 */
export function weightLoss(bookKg: string, weighedKg: string): WeightLoss {
  const book = new Decimal(bookKg);
  const loss = book.minus(weighedKg);
  const pct = book.isZero() ? new Decimal(0) : loss.div(book).times(100);
  return {
    bookKg: kg(book),
    weighedKg: kg(new Decimal(weighedKg)),
    lossKg: kg(loss),
    lossPct: pct.toFixed(1),
    high: pct.greaterThan(LOSS_ALERT_PCT),
  };
}

export interface DispatchPreview {
  stockBeforeKg: string;
  stockAfterKg: string;
  enoughStock: boolean;
  loss: WeightLoss;
}

/** What the dispatch form shows before the manager saves: stock after, and the loss. */
export function previewDispatch(stockBeforeKg: string, bookKg: string, weighedKg: string): DispatchPreview {
  const before = new Decimal(stockBeforeKg);
  const after = before.minus(bookKg);
  return {
    stockBeforeKg: kg(before),
    stockAfterKg: kg(after),
    enoughStock: !after.isNegative(),
    loss: weightLoss(bookKg, weighedKg),
  };
}
