import type { LocalDatabase } from "@/lib/db/local";
import { istDate } from "@/lib/calculations/format";

/**
 * The phone's clock is never trusted. Whenever the server answers, we note how
 * far the phone was from the server clock. The offset travels with each entry
 * (as an advisory, hashed field) and is used to pick the right day's rate even
 * if the phone's date is wrong. The server still stamps its own receive time.
 */

const CLOCK_KEY = "clockOffset";
const LAST_SYNC_KEY = "lastSyncAt";

export interface ClockOffset {
  /** server time minus device time, in milliseconds. */
  offsetMs: number;
  /** Device time when it was measured. */
  measuredAt: string;
}

/** `serverTime` is the server's ISO time; `deviceTime` is when the reply arrived. */
export async function recordServerTime(
  db: LocalDatabase,
  serverTime: string,
  deviceTime: Date = new Date(),
): Promise<ClockOffset | null> {
  const server = Date.parse(serverTime);
  if (!Number.isFinite(server)) return null;
  const value: ClockOffset = { offsetMs: server - deviceTime.getTime(), measuredAt: deviceTime.toISOString() };
  await db.meta.put({ key: CLOCK_KEY, value });
  return value;
}

export async function getClockOffset(db: LocalDatabase): Promise<ClockOffset | null> {
  const record = await db.meta.get(CLOCK_KEY);
  const value = record?.value as ClockOffset | undefined;
  return value && Number.isFinite(value.offsetMs) ? value : null;
}

/** Best estimate of real time: the device clock corrected by the last measured offset. */
export async function estimatedServerNow(db: LocalDatabase, deviceNow: Date = new Date()): Promise<Date> {
  const offset = await getClockOffset(db);
  return new Date(deviceNow.getTime() + (offset?.offsetMs ?? 0));
}

/** The date (IST) whose published rate applies to a purchase made now. */
export async function businessDate(db: LocalDatabase, deviceNow: Date = new Date()): Promise<string> {
  return istDate((await estimatedServerNow(db, deviceNow)).toISOString());
}

export async function markSyncSucceeded(db: LocalDatabase, when: Date = new Date()): Promise<void> {
  await db.meta.put({ key: LAST_SYNC_KEY, value: when.toISOString() });
}

export async function getLastSyncAt(db: LocalDatabase): Promise<string | null> {
  const record = await db.meta.get(LAST_SYNC_KEY);
  return typeof record?.value === "string" ? record.value : null;
}
