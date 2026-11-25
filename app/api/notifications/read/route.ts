import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, requireUser } from "@/lib/authz";
import { markNotificationsRead } from "@/lib/notifications";

const bodySchema = z.object({ ids: z.array(z.number().int().positive()).max(100).optional() }).strict();

// ROUND3 W-6 — mark the person's own notifications read (the given ones, or all).
export async function POST(req: Request) {
  try {
    const session = await requireUser();
    const { ids } = bodySchema.parse(await req.json().catch(() => ({})));
    const marked = await markNotificationsRead(prisma, session.user.id, ids);
    return NextResponse.json({ marked });
  } catch (e) {
    return apiError(e);
  }
}
