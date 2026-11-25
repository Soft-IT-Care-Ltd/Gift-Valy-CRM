import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, requirePermissionCtx } from "@/lib/authz";
import { assignWebsiteOrder, viewerTeamIds } from "@/lib/website-orders";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z.object({ userId: z.number().int().positive() }).strict();

// ROUND3 W-6 — hand a website order (still a draft) to a Sales Executive.
// orders.assign: with orders.view_all any order to any active SE; a Team
// Leader within their own teams (plus unassigned orders). Audited; bell.
export async function POST(req: Request, { params }: Params) {
  try {
    const { session, permissions } = await requirePermissionCtx("orders.assign");
    const id = Number((await params).id);
    const { userId } = bodySchema.parse(await req.json());
    const anyTeam = permissions.includes("orders.view_all");
    const teamIds = anyTeam ? [] : await viewerTeamIds(prisma, session.user.id);
    await prisma.$transaction((tx) =>
      assignWebsiteOrder(tx, { userId: session.user.id, anyTeam, teamIds }, { orderId: id, seId: userId })
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
