import { redirect } from "next/navigation";
import { AppHeader } from "@/components/layout/app-header";
import { OfflineProvider } from "@/components/offline/offline-provider";
import { getMessages } from "@/lib/i18n/messages";
import { getPart4Messages } from "@/lib/i18n/part4-messages";
import { getPart6Messages } from "@/lib/i18n/part6-messages";
import { getPart5Messages } from "@/lib/i18n/part5-messages";
import { getSession } from "@/lib/services/session";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");

  const t = getMessages(session.profile.preferred_lang);
  const roleLabel =
    session.profile.role === "office_manager"
      ? session.profile.preferred_lang === "mr" ? "कार्यालय व्यवस्थापक" : "Office manager"
      : session.centre?.name ?? (session.profile.preferred_lang === "mr" ? "केंद्र ऑपरेटर" : "Centre operator");

  const shell = (
    <div className="min-h-dvh" lang={session.profile.preferred_lang}>
      <AppHeader t={t} userName={session.profile.full_name} roleLabel={roleLabel} role={session.profile.role} pricesLabel={getPart4Messages(session.profile.preferred_lang).nav.prices} paymentsLabel={getPart5Messages(session.profile.preferred_lang).nav.payments} stockLabel={getPart5Messages(session.profile.preferred_lang).nav.stock} anomaliesLabel={getPart6Messages(session.profile.preferred_lang).nav.anomalies} />
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );

  // An operator account with no centre cannot record or read anything. Say so instead of
  // letting every page fail on missing offline context.
  if (session.profile.role === "centre_operator" && !session.centre) {
    const mr = session.profile.preferred_lang === "mr";
    return (
      <div className="min-h-dvh" lang={session.profile.preferred_lang}>
        <main className="mx-auto max-w-xl px-4 py-16 sm:px-6">
          <h1 className="text-2xl font-bold">{mr ? "तुमचे खाते केंद्राशी जोडलेले नाही" : "Your account is not linked to a centre"}</h1>
          <p className="mt-2 text-muted">
            {mr ? "कार्यालय व्यवस्थापकाला तुमचे खाते एका केंद्राशी जोडायला सांगा, मग पुन्हा लॉगिन करा." : "Ask the office manager to assign your account to a centre, then sign in again."}
          </p>
        </main>
      </div>
    );
  }

  // Only centre operators record purchases, so only they need the offline machinery.
  if (session.profile.role === "centre_operator" && session.centre) {
    return (
      <OfflineProvider
        operator={{
          operatorId: session.userId,
          centreId: session.centre.id,
          centreCode: session.centre.code,
          centreName: session.centre.name,
        }}
      >
        {shell}
      </OfflineProvider>
    );
  }
  return shell;
}
