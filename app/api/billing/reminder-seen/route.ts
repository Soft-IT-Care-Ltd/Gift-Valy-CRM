import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { apiError, requireUser } from "@/lib/authz";
import { markReminderSeen } from "@/lib/platform/reminder";

// FUNNEL_LINER.md GV-9 — the bill pop-up was shown to this Admin today
// (Dhaka day). Carries no amount; only the Admin's pop-up calls it.
export async function POST() {
  try {
    const session = await requireUser();
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { isActive: true, role: { select: { name: true } } },
    });
    if (!user?.isActive || user.role.name !== "Admin") {
      return NextResponse.json({ error: "Admin only" }, { status: 403 });
    }
    await markReminderSeen(session.user.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
