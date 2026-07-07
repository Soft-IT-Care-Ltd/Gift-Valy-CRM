import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission, apiError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";

export async function GET() {
  try {
    await requirePermission("users.manage");
    const teams = await prisma.team.findMany({
      orderBy: { name: "asc" },
      include: { leader: true, _count: { select: { members: true } } },
    });
    return NextResponse.json(
      teams.map((t) => ({
        id: t.id,
        name: t.name,
        leaderUserId: t.leaderUserId,
        leaderName: t.leader?.name ?? null,
        membersCount: t._count.members,
      }))
    );
  } catch (e) {
    return apiError(e);
  }
}

const createSchema = z.object({
  name: z.string().min(1),
  leaderUserId: z.number().int().nullable().optional(),
});

export async function POST(req: Request) {
  try {
    const session = await requirePermission("users.manage");
    const data = createSchema.parse(await req.json());
    const team = await prisma.team.create({
      data: {
        name: data.name.trim(),
        leaderUserId: data.leaderUserId ?? null,
        createdBy: session.user.id,
        updatedBy: session.user.id,
      },
    });
    await logAudit({
      userId: session.user.id,
      action: "team.create",
      entity: "teams",
      entityId: team.id,
      after: team,
    });
    return NextResponse.json({ id: team.id }, { status: 201 });
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "A team with this name already exists" },
        { status: 409 }
      );
    }
    return apiError(e);
  }
}
