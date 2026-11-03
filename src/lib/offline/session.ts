import { getLocalDb } from "@/lib/db/local";
import { clearReferenceData } from "@/lib/offline/reference-data";

export const PAGE_CACHE_PREFIX = "ks-pages-";

/**
 * On sign-out the next person on a shared phone must not see the previous
 * session's farmer list or cached pages. Entries that have not synced yet are
 * deliberately kept: they are the operator's unsent work and are only ever
 * sent by the operator who recorded them.
 */
export async function clearOfflineSession(): Promise<void> {
  try {
    await clearReferenceData(getLocalDb());
  } catch {
    // Storage may be unavailable; nothing to clear then.
  }
  if (typeof caches !== "undefined") {
    const names = await caches.keys().catch(() => [] as string[]);
    await Promise.all(names.filter((n) => n.startsWith(PAGE_CACHE_PREFIX)).map((n) => caches.delete(n)));
  }
}
