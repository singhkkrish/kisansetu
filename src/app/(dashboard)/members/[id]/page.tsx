import type { Metadata } from "next";
import { Pencil } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ActiveBadge, BankStatusBadge } from "@/components/members/bank-status-badge";
import { BackLink } from "@/components/members/back-link";
import { VerifyBankButton } from "@/components/members/verify-bank-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/page-guard";
import { formatDisplayDate, formatInr, formatKg } from "@/lib/calculations/format";
import { getMessages } from "@/lib/i18n/messages";
import { getMaskedBank, getMember, listRecentPurchases } from "@/lib/services/members";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Farmer details" };

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="mt-0.5 text-base font-semibold">{children}</dd>
    </div>
  );
}

export default async function MemberDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("members:read");
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const t = getMessages(session.profile.preferred_lang);
  const m = t.members;
  const supabase = await createClient();

  const member = await getMember(supabase, id);
  if (!member) notFound();

  // Bank details are fetched only for roles that may see them, and arrive masked.
  const canSeeBank = can(session.profile.role, "members:bank:read");
  const [bank, purchases] = await Promise.all([
    canSeeBank ? getMaskedBank(supabase, id) : Promise.resolve(null),
    listRecentPurchases(supabase, id),
  ]);

  return (
    <div className="space-y-6">
      <BackLink href="/members" label={m.backToList} />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{member.fullName}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-base tabular-nums text-muted">{member.memberCode}</span>
            <ActiveBadge active={member.active} labels={{ active: m.statusActive, inactive: m.statusInactive }} />
          </div>
        </div>
        {can(session.profile.role, "members:write") && (
          <Button asChild variant="secondary">
            <Link href={`/members/${member.id}/edit`}>
              <Pencil className="h-5 w-5" aria-hidden="true" />
              {m.editFarmer}
            </Link>
          </Button>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{m.sectionBasics}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
              <Detail label={m.village}>{member.village}</Detail>
              <Detail label={m.centre}>
                {member.centreName ? `${member.centreCode} · ${member.centreName}` : "—"}
              </Detail>
              <Detail label={`${m.land} (${m.acres})`}>{member.landAcres.toFixed(2)}</Detail>
              <Detail label={m.phone}>{member.phone ?? <span className="font-normal text-muted">{m.notProvided}</span>}</Detail>
              <Detail label={m.crops}>
                <span className="flex flex-wrap gap-2">
                  {member.crops.map((crop) => (
                    <Badge key={crop} tone="success">{t.crops[crop]}</Badge>
                  ))}
                </span>
              </Detail>
              <Detail label={m.consent}>
                {member.consentRecordedAt ? formatDisplayDate(member.consentRecordedAt) : (
                  <span className="font-normal text-warn">{m.consentNotRecorded}</span>
                )}
              </Detail>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle>{m.bank}</CardTitle>
            {(bank || !canSeeBank) && (
              <BankStatusBadge
                verified={canSeeBank ? Boolean(bank?.verified) : member.bankVerified}
                labels={{ verified: m.bankVerified, unverified: m.bankUnverified }}
              />
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            {!canSeeBank ? (
              <Notice tone="info">{m.bankStaffOnly}</Notice>
            ) : bank ? (
              <>
                <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                  <Detail label={m.holderName}>{bank.holderName}</Detail>
                  <Detail label={m.ifsc}>
                    <span className="tabular-nums">{bank.ifsc}</span>
                  </Detail>
                  <div className="sm:col-span-2">
                    <Detail label={m.accountNumber}>
                      <span className="font-mono tabular-nums tracking-wider">{bank.accountMasked}</span>
                    </Detail>
                  </div>
                  {bank.verified && bank.verifiedAt && (
                    <Detail label={m.verifiedOn}>{formatDisplayDate(bank.verifiedAt)}</Detail>
                  )}
                </dl>
                {!bank.verified && (
                  <VerifyBankButton
                    memberId={member.id}
                    labels={{ verify: m.verifyBank, busy: m.verifying, failed: m.verifyFailed }}
                  />
                )}
              </>
            ) : (
              <p className="text-muted">{m.bankNone}</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{m.recentPurchases}</CardTitle>
        </CardHeader>
        <CardContent>
          {purchases.length === 0 ? (
            <p className="text-muted">{m.noPurchases}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="text-sm text-muted">
                  <tr>
                    <th scope="col" className="py-2 pr-4 font-semibold">{m.slip}</th>
                    <th scope="col" className="py-2 pr-4 font-semibold">{m.date}</th>
                    <th scope="col" className="py-2 pr-4 text-right font-semibold">{m.netWeight}</th>
                    <th scope="col" className="py-2 pr-4 text-right font-semibold">{m.amount}</th>
                    <th scope="col" className="py-2 font-semibold" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {purchases.map((purchase) => (
                    <tr key={purchase.slipNo}>
                      <td className="py-3 pr-4 tabular-nums">{purchase.slipNo}</td>
                      <td className="py-3 pr-4">{formatDisplayDate(purchase.recordedAt)}</td>
                      <td className="py-3 pr-4 text-right tabular-nums">{formatKg(purchase.netKg)} kg</td>
                      <td className="py-3 pr-4 text-right font-semibold tabular-nums">{formatInr(purchase.amount)}</td>
                      <td className="py-3">
                        <Badge tone={purchase.approvalStatus === "approved" ? "success" : "warn"}>
                          {t.status[purchase.approvalStatus as keyof typeof t.status] ?? purchase.approvalStatus}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
