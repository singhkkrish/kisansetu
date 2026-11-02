import { describe, expect, it } from "vitest";
import { cleanSearch, filtersToQuery, parseMemberFilters } from "@/lib/services/member-filters";

const CENTRE = "22222222-2222-4222-8222-222222222222";

describe("parseMemberFilters", () => {
  it("defaults to active farmers on page one", () => {
    expect(parseMemberFilters({})).toEqual({ q: "", village: "", centreId: "", status: "active", page: 1 });
  });

  it("reads the filters from the query string", () => {
    expect(parseMemberFilters({ q: "FM001", village: "Murud", centre: CENTRE, status: "all", page: "3" })).toEqual({
      q: "FM001", village: "Murud", centreId: CENTRE, status: "all", page: 3,
    });
  });

  it("ignores values that are not valid", () => {
    expect(parseMemberFilters({ centre: "C07", status: "deleted", page: "-2" })).toMatchObject({
      centreId: "", status: "active", page: 1,
    });
    expect(parseMemberFilters({ page: "abc" }).page).toBe(1);
    expect(parseMemberFilters({ page: "99999999" }).page).toBe(1);
  });

  it("takes the first value when a parameter is repeated", () => {
    expect(parseMemberFilters({ q: ["sunil", "kamal"] }).q).toBe("sunil");
  });
});

describe("cleanSearch", () => {
  it("removes characters that could change a PostgREST filter", () => {
    expect(cleanSearch("a,full_name.eq.x)")).toBe("a full_name.eq.x");
    expect(cleanSearch('x%"*\\y(z)')).toBe("x y z");
  });

  it("keeps Marathi text and tidies spaces", () => {
    expect(cleanSearch("  सुनील   जाधव ")).toBe("सुनील जाधव");
  });

  it("limits the length", () => {
    expect(cleanSearch("a".repeat(200))).toHaveLength(60);
  });
});

describe("filtersToQuery", () => {
  it("leaves out defaults", () => {
    expect(filtersToQuery({ q: "", village: "", centreId: "", status: "active" })).toBe("");
  });

  it("builds a link that parses back to the same filters", () => {
    const filters = { q: "Sunil", village: "Ganjur", centreId: CENTRE, status: "inactive" as const, page: 1 };
    const query = filtersToQuery(filters, 2);
    const parsed = parseMemberFilters(Object.fromEntries(new URLSearchParams(query)));
    expect(parsed).toEqual({ ...filters, page: 2 });
  });
});
