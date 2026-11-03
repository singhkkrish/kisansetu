import type { CachedMember, CachedPrice, LocalDatabase } from "@/lib/db/local";
import { recordServerTime } from "@/lib/offline/clock";
import type { Crop, Grade } from "@/types/domain";

/**
 * Farmers and the published rates, downloaded while online so the app keeps
 * working with no network. Only what an operator needs to record a purchase is
 * cached: no bank details, ever.
 */

const REFERENCE_KEY = "referenceDataAt";

export interface BootstrapMember {
  id: string;
  memberCode: string;
  fullName: string;
  village: string;
  phone: string | null;
  landAcres: number;
  centreId: string | null;
  crops: Crop[];
}

export interface BootstrapPage {
  members: BootstrapMember[];
  /** Present on the first page only. */
  prices?: { priceDate: string; crop: Crop; grade: Grade; ratePerQuintal: string }[];
  nextCursor: string | null;
  serverTime: string;
}

export function buildSearchKey(m: Pick<BootstrapMember, "memberCode" | "fullName" | "village">): string {
  return `${m.memberCode} ${m.fullName} ${m.village}`.toLowerCase();
}

export interface DownloadResult {
  members: number;
  prices: number;
}

/**
 * Downloads every page first and only then swaps the local copy in one
 * transaction, so a connection that drops half way leaves the old data intact.
 */
export async function downloadReferenceData(
  db: LocalDatabase,
  options: { endpoint?: string; fetchImpl?: typeof fetch } = {},
): Promise<DownloadResult> {
  const endpoint = options.endpoint ?? "/api/offline/bootstrap";
  const doFetch = options.fetchImpl ?? fetch;

  const members: CachedMember[] = [];
  let prices: CachedPrice[] = [];
  let serverTime: string | null = null;
  let cursor: string | null = null;

  for (let guard = 0; guard < 200; guard++) {
    const url: string = cursor ? `${endpoint}?cursor=${encodeURIComponent(cursor)}` : endpoint;
    const response = await doFetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Reference data download failed (${response.status})`);
    const page = (await response.json()) as BootstrapPage;

    serverTime = page.serverTime;
    for (const m of page.members) members.push({ ...m, searchKey: buildSearchKey(m) });
    if (page.prices) prices = page.prices.map((p) => ({ ...p }));
    cursor = page.nextCursor;
    if (!cursor) break;
  }
  if (cursor) throw new Error("Reference data download did not finish");

  await db.transaction("rw", db.members, db.prices, db.meta, async () => {
    await db.members.clear();
    await db.members.bulkPut(members);
    await db.prices.clear();
    await db.prices.bulkPut(prices);
    await db.meta.put({ key: REFERENCE_KEY, value: new Date().toISOString() });
  });
  if (serverTime) await recordServerTime(db, serverTime);

  return { members: members.length, prices: prices.length };
}

export async function referenceDataAge(db: LocalDatabase): Promise<string | null> {
  const record = await db.meta.get(REFERENCE_KEY);
  return typeof record?.value === "string" ? record.value : null;
}

/** Matches code, name or village, all words must appear. Code matches sort first. */
export async function searchCachedMembers(
  db: LocalDatabase,
  query: string,
  limit = 20,
): Promise<CachedMember[]> {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const matches: CachedMember[] = [];
  await db.members
    .filter((m) => {
      const key = m.searchKey ?? buildSearchKey(m);
      return words.every((w) => key.includes(w));
    })
    .each((m) => matches.push(m));

  const first = words[0];
  const rank = (m: CachedMember) =>
    m.memberCode.toLowerCase() === first ? 0 : m.memberCode.toLowerCase().startsWith(first) ? 1 : m.fullName.toLowerCase().startsWith(first) ? 2 : 3;
  matches.sort((a, b) => rank(a) - rank(b) || a.fullName.localeCompare(b.fullName));
  return matches.slice(0, limit);
}

export async function getCachedMember(db: LocalDatabase, id: string): Promise<CachedMember | undefined> {
  return db.members.get(id);
}

/** The rate published for a day, from the local copy. Null when none was downloaded. */
export async function getCachedRate(
  db: LocalDatabase,
  priceDate: string,
  crop: Crop,
  grade: Grade,
): Promise<string | null> {
  const row = await db.prices.get([priceDate, crop, grade]);
  return row?.ratePerQuintal ?? null;
}

export async function listCachedRates(db: LocalDatabase, priceDate: string): Promise<CachedPrice[]> {
  return db.prices.where("priceDate").equals(priceDate).toArray();
}

/** On sign-out: drop downloaded reference data, but never the unsynced entries. */
export async function clearReferenceData(db: LocalDatabase): Promise<void> {
  await db.transaction("rw", db.members, db.prices, db.meta, async () => {
    await db.members.clear();
    await db.prices.clear();
    await db.meta.delete(REFERENCE_KEY);
  });
}
