/**
 * A small per-user limit on AI reads, so one account cannot run up the bill.
 * It lives in this server process only; behind several instances each keeps its
 * own count, which is acceptable for a cost guard (it is not a security control).
 */
const hits = new Map<string, number[]>();

export function allowRequest(userId: string, now = Date.now(), limit = 20, windowMs = 10 * 60_000): boolean {
  const recent = (hits.get(userId) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    hits.set(userId, recent);
    return false;
  }
  recent.push(now);
  hits.set(userId, recent);
  if (hits.size > 5000) for (const [key, value] of hits) if (value.every((t) => now - t >= windowMs)) hits.delete(key);
  return true;
}

export function resetRateLimit(): void {
  hits.clear();
}
