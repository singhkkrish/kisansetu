import Dexie, { type Table } from "dexie";
import type { Crop, Grade } from "@/types/domain";
import type { EntryRecord } from "@/lib/validation/procurement";

export type LocalSyncStatus = "pending" | "synced" | "rejected";

/** An entry stored on the phone, with its position in the sync queue. */
export interface LocalEntry extends EntryRecord {
  /** Local auto-increment, gives the recording order for the hash chain. */
  seq?: number;
  syncStatus: LocalSyncStatus;
  syncAttempts: number;
  /** "flagged" entries are synced but held for manager review. */
  flagged: boolean;
  lastError?: string;
  /** Set only from the server's reply, never from the phone's clock. */
  serverReceivedAt?: string;
  /** Earliest time (epoch ms) the next automatic retry may run. */
  nextRetryAt?: number;
  createdAt: string;
}

export interface CachedMember {
  id: string;
  memberCode: string;
  fullName: string;
  village: string;
  phone: string | null;
  landAcres: number;
  centreId: string | null;
  crops: Crop[];
  /** Lower-case "code name village" so a search is one substring test. */
  searchKey: string;
}

export interface CachedPrice {
  priceDate: string;
  crop: Crop;
  grade: Grade;
  ratePerQuintal: string;
}

export interface MetaRecord {
  key: string;
  value: unknown;
}

export interface SlipBlock {
  centreCode: string;
  next: number;
  end: number;
}

export class LocalDatabase extends Dexie {
  entries!: Table<LocalEntry, number>;
  members!: Table<CachedMember, string>;
  prices!: Table<CachedPrice, [string, string, string]>;
  meta!: Table<MetaRecord, string>;

  constructor(name = "kisansetu", options?: ConstructorParameters<typeof Dexie>[1]) {
    super(name, options);
    this.version(1).stores({
      // ++seq is the primary key; clientId must stay unique so a record can
      // never be queued twice.
      entries: "++seq, &clientId, &slipNo, syncStatus, farmerId, deviceRecordedAt",
      members: "id, memberCode, fullName, village",
      prices: "[priceDate+crop+grade], priceDate",
      meta: "key",
    });
  }
}

let instance: LocalDatabase | null = null;

/** Browser singleton. Never call this during server rendering. */
export function getLocalDb(): LocalDatabase {
  if (typeof indexedDB === "undefined") {
    throw new Error("Local storage is only available in the browser");
  }
  instance ??= new LocalDatabase();
  return instance;
}
