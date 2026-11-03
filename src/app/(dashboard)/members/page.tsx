import type { Metadata } from "next";
import { Plus } from "lucide-react";
import Link from "next/link";
import { MembersFilters } from "@/components/members/members-filters";
import { MembersTable } from "@/components/members/members-table";
import { Pagination } from "@/components/members/pagination";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/page-guard";
import { getMessages } from "@/lib/i18n/messages";
import { filtersToQuery, parseMemberFilters } from "@/lib/services/member-filters";
import { MEMBER_PAGE_SIZE, listCentres, listVillages, searchMembers } from "@/lib/services/members";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Members" };

export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requirePermission("members:read");
  const t = getMessages(session.profile.preferred_lang);
  const filters = parseMemberFilters(await searchParams);

  const supabase = await createClient();
  const [result, centres, villages] = await Promise.all([
    searchMembers(supabase, filters),
    listCentres(supabase),
    listVillages(supabase),
  ]);

  const isFiltered = Boolean(filters.q || filters.village || filters.centreId || filters.status !== "active");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">{t.members.title}</h1>
        {can(session.profile.role, "members:write") && (
          <Button asChild>
            <Link href="/members/new">
              <Plus className="h-5 w-5" aria-hidden="true" />
              {t.members.addFarmer}
            </Link>
          </Button>
        )}
      </div>

      <MembersFilters filters={filters} centres={centres} villages={villages} t={t.members} />

      {result.failed ? (
        <div className="space-y-3">
          <Notice tone="error">{t.members.loadError}</Notice>
          <Button asChild variant="secondary">
            <Link href={`/members${filtersToQuery(filters, filters.page)}`}>{t.members.reload}</Link>
          </Button>
        </div>
      ) : result.rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line px-6 py-12 text-center">
          <p className="text-base text-muted">{isFiltered ? t.members.noneForSearch : t.members.none}</p>
          {isFiltered && (
            <Button asChild variant="secondary" className="mt-4">
              <Link href="/members">{t.members.clearFilters}</Link>
            </Button>
          )}
        </div>
      ) : (
        <>
          <MembersTable rows={result.rows} t={t} />
          <Pagination
            filters={filters}
            total={result.total}
            pageSize={MEMBER_PAGE_SIZE}
            shown={result.rows.length}
            t={t.members}
          />
        </>
      )}
    </div>
  );
}
