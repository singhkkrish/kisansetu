import type { Metadata } from "next";
import Link from "next/link";
import { ApprovalBadge, PaymentBadge } from "@/components/procurement/status-badges";
import { LocalEntries } from "@/components/procurement/local-entries";
import { Notice } from "@/components/ui/notice";
import { can } from "@/lib/auth/permissions";
import { requireAnyPermission } from "@/lib/auth/page-guard";
import { formatDisplayDate, formatInr, formatKg } from "@/lib/calculations/format";
import { getMessages } from "@/lib/i18n/messages";
import { LIST_LIMIT, listEntries, parseApprovalFilter } from "@/lib/services/procurement-view";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Procurement entries" };

export default async function ProcurementPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireAnyPermission("procurement:read_own_centre", "procurement:read_all");
  const t = getMessages(session.profile.preferred_lang);
  const p = t.procurement;

  // Operators see their own entries from the phone itself, so the list works offline
  // and shows entries that have not reached the server yet.
  if (session && !can(session.profile.role, "procurement:read_all")) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">{p.title}</h1>
        <LocalEntries t={t} lang={session.profile.preferred_lang} />
      </div>
    );
  }

  const filter = parseApprovalFilter((await searchParams).status);
  const { items, error } = await listEntries(await createClient(), filter);
  const filters = [
    ["all", p.filterAll],
    ["held", p.filterHeld],
    ["approved", p.filterApproved],
    ["rejected", p.filterRejected],
  ] as const;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{p.title}</h1>

      <nav aria-label={p.status} className="flex flex-wrap gap-2">
        {filters.map(([value, label]) => (
          <Link
            key={value}
            href={value === "all" ? "/procurement" : `/procurement?status=${value}`}
            aria-current={filter === value ? "page" : undefined}
            className={`inline-flex h-11 items-center rounded-lg border px-4 text-base font-semibold ${filter === value ? "border-primary bg-primary-soft text-primary" : "border-line bg-surface"}`}
          >
            {label}
          </Link>
        ))}
      </nav>

      {error ? (
        <Notice tone="error">{p.loadError}</Notice>
      ) : items.length === 0 ? (
        <p className="text-muted">{filter === "all" ? p.empty : p.emptyHeld}</p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-line bg-surface">
            <table className="w-full min-w-[56rem] text-left text-base" data-testid="entries-table">
              <thead className="border-b border-line text-sm text-muted">
                <tr>
                  <th className="px-4 py-3 font-semibold">{p.slip}</th>
                  <th className="px-4 py-3 font-semibold">{p.farmer}</th>
                  <th className="px-4 py-3 font-semibold">{p.crop}</th>
                  <th className="px-4 py-3 text-right font-semibold">{p.net}</th>
                  <th className="px-4 py-3 text-right font-semibold">{p.amount}</th>
                  <th className="px-4 py-3 font-semibold">{p.approval}</th>
                  <th className="px-4 py-3 font-semibold">{p.payment}</th>
                  <th className="px-4 py-3 font-semibold">{p.serverTime}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {items.map((e) => (
                  <tr key={e.id}>
                    <td className="px-4 py-3 font-semibold">
                      <Link href={`/procurement/${e.id}`} className="text-primary underline">{e.slipNo}</Link>
                    </td>
                    <td className="px-4 py-3">{e.farmerName}<span className="block text-xs text-muted">{e.farmerCode}</span></td>
                    <td className="px-4 py-3">{t.crops[e.crop]}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatKg(e.netKg)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatInr(e.amount)}</td>
                    <td className="px-4 py-3"><ApprovalBadge status={e.approvalStatus} t={p} /></td>
                    <td className="px-4 py-3"><PaymentBadge status={e.paymentStatus} t={p} /></td>
                    <td className="px-4 py-3 text-sm">{formatDisplayDate(e.receivedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {items.length === LIST_LIMIT && <p className="text-sm text-muted">{p.showing} {LIST_LIMIT}</p>}
        </>
      )}
    </div>
  );
}
