import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "./auth";
import { getEffectivePermissions } from "./rbac";

// PHOTO_PRINT.md — page guard for Settings → Gift print: sizes & layout need
// settings.manage (Admin), designs & messages need print.settings (Admin +
// Manager). Bounces to /login when signed out, to the first allowed tab (or
// /) when this tab is not allowed.
export async function requireGiftPrintPage(tab: "sizes" | "library") {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  const permissions = await getEffectivePermissions(session.user.id);
  const canSizes = permissions.includes("settings.manage");
  const canLibrary = permissions.includes("print.settings");
  if (tab === "sizes" && !canSizes) redirect(canLibrary ? "/settings/gift-print/designs" : "/");
  if (tab === "library" && !canLibrary) redirect(canSizes ? "/settings/gift-print" : "/");
  return { session, canSizes, canLibrary };
}
