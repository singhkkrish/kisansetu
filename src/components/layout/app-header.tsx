import { Sprout } from "lucide-react";
import Link from "next/link";
import { NavLinks, type NavItem } from "@/components/layout/nav-links";
import { SignOutButton } from "@/components/layout/sign-out-button";
import type { Messages } from "@/lib/i18n/messages";
import type { UserRole } from "@/types/domain";

interface AppHeaderProps {
  t: Messages;
  userName: string;
  roleLabel: string;
  role: UserRole;
  /** Label of the price board link, shown to office managers. */
  pricesLabel?: string;
}

export function AppHeader({ t, userName, roleLabel, role, pricesLabel = "Prices" }: AppHeaderProps) {
  const items: NavItem[] =
    role === "centre_operator"
      ? [
          { href: "/dashboard", label: t.nav.dashboard },
          { href: "/collect", label: t.nav.collect },
          { href: "/procurement", label: t.nav.entries },
          { href: "/members", label: t.nav.members },
        ]
      : [
          { href: "/dashboard", label: t.nav.dashboard },
          { href: "/members", label: t.nav.members },
          { href: "/procurement", label: t.nav.entries },
          { href: "/prices", label: pricesLabel },
        ];

  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
        <Link href="/dashboard" className="flex items-center gap-2 text-lg font-bold text-primary">
          <Sprout className="h-6 w-6" aria-hidden="true" />
          {t.appName}
        </Link>
        <div className="order-3 w-full sm:order-none sm:w-auto sm:flex-1">
          <NavLinks items={items} />
        </div>
        <div className="ml-auto flex items-center gap-3">
          <div className="hidden text-right leading-tight sm:block">
            <p className="text-sm font-semibold">{userName}</p>
            <p className="text-xs text-muted">{roleLabel}</p>
          </div>
          <SignOutButton label={t.signOut} />
        </div>
      </div>
    </header>
  );
}
