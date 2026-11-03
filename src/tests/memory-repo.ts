import type {
  EntryRow,
  InsertOutcome,
  SyncRepository,
} from "@/lib/services/sync-service";
import { IDS } from "./helpers";

/** In-memory stand-in for the database, used by the sync tests. */
export class MemoryRepo implements SyncRepository {
  entries = new Map<string, EntryRow & { server_received_at: string }>();
  events: { outcome: string; detail: Record<string, unknown> }[] = [];
  farmers = new Set<string>([IDS.farmer]);
  prices = new Map<string, string>([["2026-11-02|soybean|A", "4850.00"]]);
  /** Simulated server clock. */
  serverNow = "2026-11-02T10:00:00.000Z";

  async findEntryByClientId(clientId: string) {
    const row = this.entries.get(clientId);
    return row ? { payloadHash: row.payload_hash, serverReceivedAt: row.server_received_at } : null;
  }
  async isKnownHash(_deviceId: string, hash: string) {
    return (
      [...this.entries.values()].some((r) => r.payload_hash === hash) ||
      this.events.some((e) => e.detail.payloadHash === hash)
    );
  }
  async farmerExists(id: string) {
    return this.farmers.has(id);
  }
  async getRate(date: string, crop: string, grade: string) {
    return this.prices.get(`${date}|${crop}|${grade}`) ?? null;
  }
  async insertEntry(row: EntryRow): Promise<InsertOutcome> {
    if (this.entries.has(row.client_id)) return { status: "duplicate_client" };
    if ([...this.entries.values()].some((r) => r.slip_no === row.slip_no)) return { status: "duplicate_slip" };
    this.entries.set(row.client_id, { ...row, server_received_at: this.serverNow });
    return { status: "inserted", serverReceivedAt: this.serverNow, flagReasons: row.flag_reasons };
  }
  async logEvent(e: { outcome: string; detail: Record<string, unknown> }) {
    this.events.push(e);
  }
}
