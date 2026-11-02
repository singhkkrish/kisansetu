import { redirect } from "next/navigation";
import { AppHeader } from "@/components/layout/app-header";
import { getMessages } from "@/lib/i18n/messages";
import { getSession } from "@/lib/services/session";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");

  const t = getMessages(session.profile.preferred_lang);
  const roleLabel =
    session.profile.role === "office_manager"
      ? session.profile.preferred_lang === "mr" ? "कार्यालय व्यवस्थापक" : "Office manager"
      : session.centre?.name ?? (session.profile.preferred_lang === "mr" ? "केंद्र ऑपरेटर" : "Centre operator");

  return (
    <div className="min-h-dvh">
      <AppHeader t={t} userName={session.profile.full_name} roleLabel={roleLabel} />
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
