import { redirect } from "next/navigation";
import { getServerSession, type Session } from "next-auth";
import { authOptions } from "./auth";
import { getEffectivePermissions } from "./rbac";

// Server-component guard: bounce to /login when signed out,
// to / when the live permission check fails.
export async function requirePagePermission(key: string): Promise<Session> {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  const permissions = await getEffectivePermissions(session.user.id);
  if (!permissions.includes(key)) redirect("/");
  return session;
}
