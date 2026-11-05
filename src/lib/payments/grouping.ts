import Decimal from "decimal.js";
import { maskAccountNumber } from "@/lib/validation/bank";

/** An approved, unpaid purchase that could go into a payment run. */
export interface PayableEntry {
  id: string;
  slipNo: string;
  farmerId: string;
  farmerCode: string;
  farmerName: string;
  centreId: string;
  /** Exact decimal string, e.g. "59752.00". */
  amount: string;
  bank: { holderName: string; accountNumber: string; ifsc: string; verified: boolean } | null;
}

export interface PaymentGroup {
  farmerId: string;
  farmerCode: string;
  farmerName: string;
  beneficiaryName: string;
  /** Only the last four digits are shown anywhere a person can read this. */
  accountMasked: string;
  ifsc: string;
  entryCount: number;
  amount: string;
  entryIds: string[];
}

export type BlockedReason = "no_bank" | "bank_unverified";

export interface BlockedGroup {
  farmerId: string;
  farmerCode: string;
  farmerName: string;
  reason: BlockedReason;
  entryCount: number;
  amount: string;
}

export interface PaymentPreview {
  groups: PaymentGroup[];
  blocked: BlockedGroup[];
  payable: { farmers: number; entries: number; amount: string };
  blockedTotals: { farmers: number; entries: number; amount: string };
}

const money = (d: Decimal) => d.toFixed(2);

/**
 * Groups purchases by farmer, the same way the database does when a run is
 * generated, so what a manager reviews is what will be created. Amounts are
 * added as exact decimals. A farmer without a verified bank account cannot be
 * paid: they are listed separately and their entries are not counted as payable.
 */
export function groupByFarmer(entries: readonly PayableEntry[]): PaymentPreview {
  const payable = new Map<string, PaymentGroup & { total: Decimal }>();
  const blocked = new Map<string, BlockedGroup & { total: Decimal }>();

  for (const e of entries) {
    const amount = new Decimal(e.amount);
    if (e.bank?.verified) {
      const g = payable.get(e.farmerId) ?? {
        farmerId: e.farmerId,
        farmerCode: e.farmerCode,
        farmerName: e.farmerName,
        beneficiaryName: e.bank.holderName,
        accountMasked: maskAccountNumber(e.bank.accountNumber),
        ifsc: e.bank.ifsc,
        entryCount: 0,
        amount: "0.00",
        entryIds: [],
        total: new Decimal(0),
      };
      g.entryCount += 1;
      g.entryIds.push(e.id);
      g.total = g.total.plus(amount);
      payable.set(e.farmerId, g);
    } else {
      const g = blocked.get(e.farmerId) ?? {
        farmerId: e.farmerId,
        farmerCode: e.farmerCode,
        farmerName: e.farmerName,
        reason: (e.bank ? "bank_unverified" : "no_bank") as BlockedReason,
        entryCount: 0,
        amount: "0.00",
        total: new Decimal(0),
      };
      g.entryCount += 1;
      g.total = g.total.plus(amount);
      blocked.set(e.farmerId, g);
    }
  }

  const groups = [...payable.values()]
    .map(({ total, ...g }) => ({ ...g, amount: money(total) }))
    .sort((a, b) => a.farmerCode.localeCompare(b.farmerCode));
  const blockedList = [...blocked.values()]
    .map(({ total, ...g }) => ({ ...g, amount: money(total) }))
    .sort((a, b) => a.farmerCode.localeCompare(b.farmerCode));

  const sum = (list: { amount: string }[]) => money(list.reduce((t, g) => t.plus(g.amount), new Decimal(0)));
  const count = (list: { entryCount: number }[]) => list.reduce((n, g) => n + g.entryCount, 0);

  return {
    groups,
    blocked: blockedList,
    payable: { farmers: groups.length, entries: count(groups), amount: sum(groups) },
    blockedTotals: { farmers: blockedList.length, entries: count(blockedList), amount: sum(blockedList) },
  };
}

/** Sum of exact decimal strings, as a two-decimal string. */
export function sumAmounts(amounts: readonly string[]): string {
  return amounts.reduce((t, a) => t.plus(a), new Decimal(0)).toFixed(2);
}
