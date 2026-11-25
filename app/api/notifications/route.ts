import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { apiError, requireUser } from "@/lib/authz";
import { listNotifications, unreadNotificationCount } from "@/lib/notifications";

// ROUND3 W-6 — the bell: the signed-in person's own notifications, newest
// first, and the unread count (?count=1 → the count alone, for the header).
export async function GET(req: Request) {
  try {
    const session = await requireUser();
    const unread = await unreadNotificationCount(prisma, session.user.id);
    if (new URL(req.url).searchParams.get("count") === "1") {
      return NextResponse.json({ unread }, { headers: { "Cache-Control": "no-store" } });
    }
    const items = await listNotifications(prisma, session.user.id);
    return NextResponse.json({ unread, items }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return apiError(e);
  }
}
