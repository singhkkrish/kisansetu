import type { Metadata } from "next";
import { MemberForm } from "@/components/members/member-form";
import { BackLink } from "@/components/members/back-link";
import { requirePermission } from "@/lib/auth/page-guard";
import { getMessages } from "@/lib/i18n/messages";
import { listCentres } from "@/lib/services/members";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Add farmer" };

export default async function NewMemberPage() {
  // Checked on the server before anything is loaded; hiding the link is not the control.
  const session = await requirePermission("members:write");
  const t = getMessages(session.profile.preferred_lang);
  const centres = await listCentres(await createClient());

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <BackLink href="/members" label={t.members.backToList} />
      <h1 className="text-2xl font-bold">{t.members.addFarmer}</h1>
      <MemberForm mode="create" centres={centres} t={t.members} cropNames={t.crops} />
    </div>
  );
}
