import { calculateProcurement } from "@/lib/calculations/procurement";
import type { LocalDatabase, LocalEntry, SlipBlock } from "@/lib/db/local";
import { getClockOffset } from "@/lib/offline/clock";
import { computePayloadHash } from "@/lib/offline/integrity";
import {
  procurementInputSchema,
  type EntryRecord,
  type ProcurementInput,
} from "@/lib/validation/procurement";

const SLIP_BLOCK_KEY = "slipBlock";
const LAST_HASH_KEY = "lastHash";
const DEVICE_ID_KEY = "deviceId";

export class SlipBlockExhaustedError extends Error {
  constructor() {
    super("No slip numbers left on this phone. Connect to the network to get more.");
    this.name = "SlipBlockExhaustedError";
  }
}

export class WrongCentreSlipBlockError extends Error {
  constructor() {
    super("The slip numbers on this phone belong to a different centre. Connect to get new ones.");
    this.name = "WrongCentreSlipBlockError";
  }
}

export interface RecordingContext {
  operatorId: string;
  centreId: string;
  /** When given, the slip block on the phone must belong to this centre. */
  centreCode?: string;
  deviceId: string;
  /**
   * Fixed for one wizard run. If the operator taps Save twice, or the screen
   * reloads and saves again, the same entry comes back instead of a second one.
   */
  clientId?: string;
  now?: Date;
}

export function formatSlipNo(centreCode: string, n: number): string {
  return `${centreCode}-${String(n).padStart(5, "0")}`;
}

/** Stable per-install id, created on first use. */
export async function getOrCreateDeviceId(db: LocalDatabase): Promise<string> {
  const existing = await db.meta.get(DEVICE_ID_KEY);
  if (typeof existing?.value === "string") return existing.value;
  const id = `dev-${globalThis.crypto.randomUUID()}`;
  await db.meta.put({ key: DEVICE_ID_KEY, value: id });
  return id;
}

/** Stores a block of slip numbers handed out by the server while online. */
export async function setSlipBlock(
  db: LocalDatabase,
  block: { centreCode: string; start: number; end: number },
): Promise<void> {
  const value: SlipBlock = { centreCode: block.centreCode, next: block.start, end: block.end };
  await db.meta.put({ key: SLIP_BLOCK_KEY, value });
}

export async function slipNumbersRemaining(db: LocalDatabase): Promise<number> {
  const record = await db.meta.get(SLIP_BLOCK_KEY);
  const block = record?.value as SlipBlock | undefined;
  return block ? Math.max(0, block.end - block.next + 1) : 0;
}

interface ChainState {
  block: SlipBlock;
  prevHash: string | null;
}

async function readChainState(db: LocalDatabase): Promise<ChainState> {
  const [blockRecord, lastHashRecord] = await Promise.all([
    db.meta.get(SLIP_BLOCK_KEY),
    db.meta.get(LAST_HASH_KEY),
  ]);
  const block = blockRecord?.value as SlipBlock | undefined;
  if (!block || block.next > block.end) throw new SlipBlockExhaustedError();
  return {
    block,
    prevHash: typeof lastHashRecord?.value === "string" ? lastHashRecord.value : null,
  };
}

const MAX_RECORD_ATTEMPTS = 3;

/**
 * Validates the operator's input, derives net weight and amount, assigns a slip
 * number, chains the entry to the previous one and queues it.
 *
 * Hashing uses Web Crypto, which is asynchronous, and IndexedDB closes a
 * transaction that awaits anything other than its own requests. So the hash is
 * computed first, and the write transaction then confirms the slip counter and
 * chain head have not moved before committing. If another save got in between
 * (two tabs, a double tap), it simply tries again with fresh state. A crash can
 * therefore never burn a slip number or break the chain.
 */
export async function recordProcurement(
  db: LocalDatabase,
  rawInput: ProcurementInput,
  context: RecordingContext,
): Promise<LocalEntry> {
  const input = procurementInputSchema.parse(rawInput);
  const calc = calculateProcurement(input);
  const now = context.now ?? new Date();
  const clientId = context.clientId ?? globalThis.crypto.randomUUID();

  for (let attempt = 0; attempt < MAX_RECORD_ATTEMPTS; attempt++) {
    const already = await db.entries.where("clientId").equals(clientId).first();
    if (already) return already;

    const { block, prevHash } = await readChainState(db);
    if (context.centreCode && block.centreCode !== context.centreCode) {
      throw new WrongCentreSlipBlockError();
    }
    const offset = await getClockOffset(db);

    const unsigned: Omit<EntryRecord, "payloadHash"> = {
      clientId,
      slipNo: formatSlipNo(block.centreCode, block.next),
      farmerId: input.farmerId,
      centreId: context.centreId,
      operatorId: context.operatorId,
      crop: input.crop,
      grade: input.grade,
      grossKg: input.grossKg,
      tareKg: input.tareKg,
      moisturePct: input.moisturePct,
      netKg: calc.netKg,
      ratePerQuintal: input.ratePerQuintal,
      amount: calc.amount,
      deviceId: context.deviceId,
      deviceRecordedAt: now.toISOString(),
      prevHash,
      clockOffsetMs: offset ? Math.round(offset.offsetMs) : null,
    };
    const payloadHash = await computePayloadHash(unsigned);

    const entry: LocalEntry = {
      ...unsigned,
      payloadHash,
      syncStatus: "pending",
      syncAttempts: 0,
      flagged: false,
      createdAt: now.toISOString(),
    };

    const committed = await db.transaction("rw", db.entries, db.meta, async () => {
      if (await db.entries.where("clientId").equals(clientId).first()) return "existing" as const;
      const current = await db.meta.get(SLIP_BLOCK_KEY);
      const currentHead = await db.meta.get(LAST_HASH_KEY);
      const currentBlock = current?.value as SlipBlock | undefined;
      const currentPrev = typeof currentHead?.value === "string" ? currentHead.value : null;

      if (currentBlock?.next !== block.next || currentPrev !== prevHash) return false as const;

      await db.entries.add(entry);
      await db.meta.put({ key: SLIP_BLOCK_KEY, value: { ...block, next: block.next + 1 } });
      await db.meta.put({ key: LAST_HASH_KEY, value: payloadHash });
      return true as const;
    });

    if (committed === "existing") {
      const saved = await db.entries.where("clientId").equals(clientId).first();
      if (saved) return saved;
    } else if (committed) {
      return entry;
    }
  }

  throw new Error("Could not save the entry because another save kept changing the queue. Try again.");
}

/** Oldest first, so the server sees the chain in order. */
export async function getPendingEntries(
  db: LocalDatabase,
  limit: number,
  operatorId?: string,
): Promise<LocalEntry[]> {
  const rows = await db.entries.where("syncStatus").equals("pending").sortBy("seq");
  return rows.filter((e) => !operatorId || e.operatorId === operatorId).slice(0, limit);
}

export async function countPending(db: LocalDatabase): Promise<number> {
  return db.entries.where("syncStatus").equals("pending").count();
}

export async function countByStatus(
  db: LocalDatabase,
): Promise<{ pending: number; synced: number; failed: number }> {
  const [pending, synced, failed] = await Promise.all([
    db.entries.where("syncStatus").equals("pending").count(),
    db.entries.where("syncStatus").equals("synced").count(),
    db.entries.where("syncStatus").equals("rejected").count(),
  ]);
  return { pending, synced, failed };
}

export async function listRecentEntries(db: LocalDatabase, limit = 20): Promise<LocalEntry[]> {
  const rows = await db.entries.orderBy("seq").reverse().limit(limit).toArray();
  return rows;
}
