import Link from "next/link";
import type { Session } from "next-auth";
import { Globe } from "lucide-react";
import { prisma } from "@/lib/db";
import { orderScopeWhere, orderViewScope } from "@/lib/orders";
import { getWebsiteUserId } from "@/lib/system-user";
import { unassignedWebsiteWhere } from "@/lib/website-assignment";
import { websiteWaitingCount } from "@/lib/website-orders";

// ROUND3 W-6 — on the home dashboard: website orders waiting for their
// confirmation in the viewer's scope (an SE: their own), and — for
// orders.assign holders — the ones nobody could be given. Nothing when both
// are zero.
export async function WebsiteOrdersAlert({ session, permissions }: { session: Session; permissions: string[] }) {
  if (!orderViewScope(permissions)) return null;
  const scope = await orderScopeWhere(session, permissions);
  const canAssign = permissions.includes("orders.assign");
  const [waiting, unassigned] = await Promise.all([
    websiteWaitingCount(scope),
    canAssign ? prisma.order.count({ where: unassignedWebsiteWhere(await getWebsiteUserId(prisma)) }) : Promise.resolve(0),
  ]);
  if (waiting === 0 && unassigned === 0) return null;
  return (
    <Link
      href="/orders?status=WEBSITE"
      className="flex flex-wrap items-center gap-2 rounded-md border border-sky-300 bg-sky-50 px-3 py-2 text-sm text-sky-900 hover:bg-sky-100 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-100"
    >
      <Globe className="size-4" />
      <span className="font-medium">
        {waiting} website {waiting === 1 ? "order" : "orders"} waiting for confirmation
      </span>
      {unassigned > 0 && <span className="font-semibold text-amber-700 dark:text-amber-300">· {unassigned} not assigned to anyone</span>}
      <span className="ml-auto underline underline-offset-2">Open</span>
    </Link>
  );
}
