import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermissionCtx, apiError, AuthzError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { dailyCountSchema } from "@/lib/leads";
import { dbDate } from "@/lib/orders";

// SPEC §3.1 bulk quick-entry — log a daily lead count per source/campaign when
// individual entry isn't practical. One row per (date, user, source, campaign);
// re-submitting the same key replaces the count (a correction, not an add).
// Gated by its own leads.bulk permission (CORRECTIONS Leads §7).
export async function POST(req: Request) {
  try {
    const { session, permissions } = await requirePermissionCtx("leads.bulk");
    const data = dailyCountSchema.parse(await req.json());

    let userId = session.user.id;
    if (data.userId && data.userId !== session.user.id) {
      if (!permissions.includes("leads.reassign")) {
        throw new AuthzError(403, "Not allowed to log counts for another SE");
      }
      const target = await prisma.user.findUnique({
        where: { id: data.userId },
        select: { id: true, isActive: true },
      });
      if (!target || !target.isActive) throw new AuthzError(400, "User not found");
      userId = data.userId;
    }

    const date = dbDate(data.date); // @db.Date — UTC-midnight, not a +06 instant
    const campaignName = data.campaignName; // null-safe manual upsert (see @@index, no unique)

    // Manual upsert: composite key includes a nullable campaign, so match
    // explicitly rather than rely on a DB unique (NULLs are distinct in SQL).
    const existing = await prisma.leadDailyCount.findFirst({
      where: { date, userId, source: data.source, campaignName },
      select: { id: true, count: true },
    });

    let id: number;
    if (existing) {
      await prisma.leadDailyCount.update({
        where: { id: existing.id },
        data: { count: data.count, updatedBy: session.user.id },
      });
      id = existing.id;
    } else {
      const created = await prisma.leadDailyCount.create({
        data: {
          date,
          userId,
          source: data.source,
          campaignName,
          count: data.count,
          createdBy: session.user.id,
          updatedBy: session.user.id,
        },
        select: { id: true },
      });
      id = created.id;
    }

    await logAudit({
      userId: session.user.id,
      action: existing ? "lead_daily_count.update" : "lead_daily_count.create",
      entity: "lead_daily_counts",
      entityId: id,
      after: { date: data.date, userId, source: data.source, campaignName, count: data.count },
    });
    return NextResponse.json({ id }, { status: existing ? 200 : 201 });
  } catch (e) {
    return apiError(e);
  }
}
