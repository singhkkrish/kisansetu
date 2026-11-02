import { z } from "zod";

export const MEMBER_STATUS_FILTERS = ["active", "inactive", "all"] as const;
export type MemberStatusFilter = (typeof MEMBER_STATUS_FILTERS)[number];

export interface MemberFilters {
  q: string;
  village: string;
  centreId: string;
  status: MemberStatusFilter;
  page: number;
}

/**
 * Removes characters that have meaning inside a PostgREST filter expression, so
 * typed text can be placed into an `or(...)` filter without changing its shape.
 */
export function cleanSearch(raw: string): string {
  return raw.replace(/[,()%*\\"]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
}

type Raw = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

const uuid = z.uuid();

/** Turns untrusted query parameters into safe filters. Bad values fall back to defaults. */
export function parseMemberFilters(params: Raw): MemberFilters {
  const status = first(params.status);
  const page = Number.parseInt(first(params.page), 10);
  const centre = first(params.centre).trim();

  return {
    q: cleanSearch(first(params.q)),
    village: first(params.village).trim().slice(0, 60),
    centreId: uuid.safeParse(centre).success ? centre : "",
    status: (MEMBER_STATUS_FILTERS as readonly string[]).includes(status)
      ? (status as MemberStatusFilter)
      : "active",
    page: Number.isInteger(page) && page >= 1 && page <= 10_000 ? page : 1,
  };
}

/** Query string for the filters, leaving out anything that is at its default. */
export function filtersToQuery(filters: Partial<MemberFilters>, page?: number): string {
  const query = new URLSearchParams();
  if (filters.q) query.set("q", filters.q);
  if (filters.village) query.set("village", filters.village);
  if (filters.centreId) query.set("centre", filters.centreId);
  if (filters.status && filters.status !== "active") query.set("status", filters.status);
  if (page && page > 1) query.set("page", String(page));
  const text = query.toString();
  return text ? `?${text}` : "";
}
