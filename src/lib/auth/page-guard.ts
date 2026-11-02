import { redirect } from "next/navigation";
import { can, type Permission } from "@/lib/auth/permissions";
import { getSession, type SessionInfo } from "@/lib/services/session";

/**
 * Server-side guard for pages. Call it before loading any data: a signed-out
 * visitor is sent to sign in, and a signed-in user without the permission is
 * sent back to the dashboard. The page body never runs for either.
 */
export async function requirePermission(permission: Permission): Promise<SessionInfo> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!can(session.profile.role, permission)) redirect("/dashboard?denied=1");
  return session;
}
