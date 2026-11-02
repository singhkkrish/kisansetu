import type { Messages } from "@/lib/i18n/messages";
import type { FarmerMember } from "@/types/domain";

type Row = Pick<FarmerMember, "id" | "member_code" | "full_name" | "village" | "land_acres">;

export function MembersTable({ rows, t }: { rows: Row[]; t: Messages["members"] }) {
  return (
    <>
      {/* Phones: one card per member. */}
      <ul className="divide-y divide-line rounded-xl border border-line bg-surface md:hidden">
        {rows.map((m) => (
          <li key={m.id} className="px-4 py-3">
            <p className="text-base font-semibold">{m.full_name}</p>
            <p className="text-sm text-muted">
              {m.member_code} · {m.village} · {m.land_acres} {t.acres}
            </p>
          </li>
        ))}
      </ul>

      {/* Desktop: a plain data table. */}
      <div className="hidden overflow-hidden rounded-xl border border-line bg-surface md:block">
        <table className="w-full text-left">
          <thead className="border-b border-line bg-background text-sm text-muted">
            <tr>
              <th scope="col" className="px-5 py-3 font-semibold">{t.code}</th>
              <th scope="col" className="px-5 py-3 font-semibold">{t.name}</th>
              <th scope="col" className="px-5 py-3 font-semibold">{t.village}</th>
              <th scope="col" className="px-5 py-3 text-right font-semibold">{t.land} ({t.acres})</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((m) => (
              <tr key={m.id}>
                <td className="px-5 py-3 tabular-nums text-muted">{m.member_code}</td>
                <td className="px-5 py-3 font-semibold">{m.full_name}</td>
                <td className="px-5 py-3">{m.village}</td>
                <td className="px-5 py-3 text-right tabular-nums">{m.land_acres}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
