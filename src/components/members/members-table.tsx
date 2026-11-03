import Link from "next/link";
import { ActiveBadge, BankStatusBadge } from "@/components/members/bank-status-badge";
import type { Messages } from "@/lib/i18n/messages";
import type { MemberListItem } from "@/lib/services/members";

interface MembersTableProps {
  rows: MemberListItem[];
  t: Messages;
}

function cropList(crops: MemberListItem["crops"], names: Messages["crops"]): string {
  return crops.map((crop) => names[crop]).join(", ");
}

export function MembersTable({ rows, t }: MembersTableProps) {
  const m = t.members;
  const bankLabels = { verified: m.bankVerified, unverified: m.bankUnverified };
  const activeLabels = { active: m.statusActive, inactive: m.statusInactive };

  return (
    <>
      {/* Phones: one card per farmer, name first. */}
      <ul className="divide-y divide-line rounded-xl border border-line bg-surface md:hidden">
        {rows.map((member) => (
          <li key={member.id}>
            <Link href={`/members/${member.id}`} className="block px-4 py-3.5 active:bg-primary-soft">
              <div className="flex items-start justify-between gap-3">
                <p className="text-base font-semibold">{member.fullName}</p>
                <span className="shrink-0 text-sm tabular-nums text-muted">{member.memberCode}</span>
              </div>
              <p className="mt-0.5 text-sm text-muted">
                {member.village}
                {member.centreCode ? ` · ${member.centreCode}` : ""} · {member.landAcres.toFixed(2)} {m.acres}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <BankStatusBadge verified={member.bankVerified} labels={bankLabels} />
                {!member.active && <ActiveBadge active={false} labels={activeLabels} />}
              </div>
            </Link>
          </li>
        ))}
      </ul>

      {/* Larger screens: a data table. */}
      <div className="hidden overflow-x-auto rounded-xl border border-line bg-surface md:block">
        <table className="w-full text-left">
          <thead className="border-b border-line bg-background text-sm text-muted">
            <tr>
              <th scope="col" className="px-5 py-3 font-semibold">{m.farmerId}</th>
              <th scope="col" className="px-5 py-3 font-semibold">{m.name}</th>
              <th scope="col" className="px-5 py-3 font-semibold">{m.village}</th>
              <th scope="col" className="px-5 py-3 font-semibold">{m.centre}</th>
              <th scope="col" className="px-5 py-3 text-right font-semibold">{m.land} ({m.acres})</th>
              <th scope="col" className="px-5 py-3 font-semibold">{m.crops}</th>
              <th scope="col" className="px-5 py-3 font-semibold">{m.bank}</th>
              <th scope="col" className="px-5 py-3 font-semibold">{m.statusFilter}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((member) => (
              <tr key={member.id} className="hover:bg-primary-soft/40">
                <td className="px-5 py-3 tabular-nums text-muted">{member.memberCode}</td>
                <td className="px-5 py-3">
                  <Link href={`/members/${member.id}`} className="font-semibold text-primary underline-offset-2 hover:underline">
                    {member.fullName}
                  </Link>
                </td>
                <td className="px-5 py-3">{member.village}</td>
                <td className="px-5 py-3 tabular-nums">{member.centreCode ?? "—"}</td>
                <td className="px-5 py-3 text-right tabular-nums">{member.landAcres.toFixed(2)}</td>
                <td className="px-5 py-3 text-sm">{cropList(member.crops, t.crops)}</td>
                <td className="px-5 py-3">
                  <BankStatusBadge verified={member.bankVerified} labels={bankLabels} />
                </td>
                <td className="px-5 py-3">
                  <ActiveBadge active={member.active} labels={activeLabels} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
