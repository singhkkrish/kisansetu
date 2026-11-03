import { Search } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { Messages } from "@/lib/i18n/messages";
import type { MemberFilters } from "@/lib/services/member-filters";
import type { CentreOption } from "@/lib/services/members";

interface MembersFiltersProps {
  filters: MemberFilters;
  centres: CentreOption[];
  villages: string[];
  t: Messages["members"];
}

/**
 * A plain GET form: it works without JavaScript, keeps filters in the URL so a
 * view can be shared or bookmarked, and costs nothing on a 2 GB phone. On a
 * phone the search box and button share a row so the list stays in view.
 */
export function MembersFilters({ filters, centres, villages, t }: MembersFiltersProps) {
  const isFiltered = Boolean(filters.q || filters.village || filters.centreId || filters.status !== "active");

  return (
    <form role="search" method="get" action="/members" className="space-y-3 rounded-xl border border-line bg-surface p-4 sm:p-5">
      <div>
        <Label htmlFor="q">{t.search}</Label>
        <div className="flex gap-2">
          <Input
            id="q"
            name="q"
            defaultValue={filters.q}
            placeholder={t.searchPlaceholder}
            autoComplete="off"
            enterKeyHint="search"
          />
          <Button type="submit" aria-label={t.search} className="shrink-0 px-4 sm:px-5">
            <Search className="h-5 w-5" aria-hidden="true" />
            <span className="hidden sm:inline">{t.search}</span>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <div className="col-span-2 md:col-span-1">
          <Label htmlFor="village">{t.village}</Label>
          <Select id="village" name="village" defaultValue={filters.village}>
            <option value="">{t.allVillages}</option>
            {villages.map((village) => (
              <option key={village} value={village}>
                {village}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="centre">{t.centre}</Label>
          <Select id="centre" name="centre" defaultValue={filters.centreId}>
            <option value="">{t.allCentres}</option>
            {centres.map((centre) => (
              <option key={centre.id} value={centre.id}>
                {centre.code} · {centre.name.replace(/ Collection Centre$/, "")}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="status">{t.statusFilter}</Label>
          <Select id="status" name="status" defaultValue={filters.status}>
            <option value="active">{t.statusActive}</option>
            <option value="inactive">{t.statusInactive}</option>
            <option value="all">{t.statusAll}</option>
          </Select>
        </div>
      </div>

      {isFiltered && (
        <Button asChild variant="ghost" size="sm">
          <Link href="/members">{t.clearFilters}</Link>
        </Button>
      )}
    </form>
  );
}
