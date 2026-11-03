import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { BackLink } from "@/components/members/back-link";
import { MemberForm } from "@/components/members/member-form";
import { requirePermission } from "@/lib/auth/page-guard";
import { getMessages } from "@/lib/i18n/messages";
import { getMaskedBank, getMember, listCentres } from "@/lib/services/members";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Edit farmer" };

export default async function EditMemberPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("members:write");
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const t = getMessages(session.profile.preferred_lang);
  const supabase = await createClient();

  const member = await getMember(supabase, id);
  if (!member) notFound();
  const [bank, centres] = await Promise.all([getMaskedBank(supabase, id), listCentres(supabase)]);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <BackLink href={`/members/${id}`} label={member.fullName} />
      <h1 className="text-2xl font-bold">{t.members.editFarmer}</h1>
      <MemberForm
        mode="edit"
        centres={centres}
        t={t.members}
        cropNames={t.crops}
        initial={{
          id: member.id,
          fullName: member.fullName,
          village: member.village,
          centreId: member.centreId ?? "",
          phone: member.phone ?? "",
          landAcres: member.landAcres.toFixed(2),
          crops: member.crops,
          active: member.active,
          bank: bank ? { holderName: bank.holderName, accountMasked: bank.accountMasked, ifsc: bank.ifsc } : null,
        }}
      />
    </div>
  );
}
