import type { Metadata } from "next";
import { CollectWizard } from "@/components/procurement/collect-wizard";
import { SyncBar } from "@/components/offline/sync-status";
import { requirePermission } from "@/lib/auth/page-guard";
import { getMessages } from "@/lib/i18n/messages";

export const metadata: Metadata = { title: "New procurement entry" };

export default async function CollectPage() {
  const session = await requirePermission("procurement:create");
  const t = getMessages(session.profile.preferred_lang);
  return (
    <div className="space-y-5">
      <SyncBar t={t.sync} />
      <CollectWizard t={t} />
    </div>
  );
}
