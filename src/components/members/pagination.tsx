import Link from "next/link";
import { cn } from "@/lib/utils";
import type { Messages } from "@/lib/i18n/messages";
import { filtersToQuery, type MemberFilters } from "@/lib/services/member-filters";

interface PaginationProps {
  filters: MemberFilters;
  total: number;
  pageSize: number;
  shown: number;
  t: Messages["members"];
}

const base = "inline-flex h-11 items-center rounded-lg border border-line px-4 text-sm font-semibold";

export function Pagination({ filters, total, pageSize, shown, t }: PaginationProps) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(filters.page, pages);
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;

  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted">
        {t.showing} {first}–{first + shown - (shown > 0 ? 1 : 0)} / {total}
        {pages > 1 && (
          <>
            {" "}
            · {t.pageOf} {page}/{pages}
          </>
        )}
      </p>
      {pages > 1 && (
        <div className="flex gap-2">
          {page > 1 ? (
            <Link href={`/members${filtersToQuery(filters, page - 1)}`} className={cn(base, "bg-surface hover:bg-primary-soft")} rel="prev">
              {t.previous}
            </Link>
          ) : (
            <span aria-disabled="true" className={cn(base, "opacity-40")}>{t.previous}</span>
          )}
          {page < pages ? (
            <Link href={`/members${filtersToQuery(filters, page + 1)}`} className={cn(base, "bg-surface hover:bg-primary-soft")} rel="next">
              {t.next}
            </Link>
          ) : (
            <span aria-disabled="true" className={cn(base, "opacity-40")}>{t.next}</span>
          )}
        </div>
      )}
    </nav>
  );
}
