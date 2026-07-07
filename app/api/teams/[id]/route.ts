import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission, apiError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";

type Params = { params: Promise<{ id: string }> };

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  leaderUserId: z.number().int().nullable().optional(),
});

export async function PATCH(req: Request, { params }: Params) {
  try {
    const session = await requirePermission("users.manage");
    const id = Number((await params).id);
    const data = updateSchema.parse(await req.json());

    const before = await prisma.team.findUnique({ where: { id } });
    if (!before) {
      return NextResponse.json({ error: "Team not found" }, { status: 404 });
    }
    const after = await prisma.team.update({
      where: { id },
      data: {
        name: data.name?.trim(),
        leaderUserId:
          data.leaderUserId === undefined ? undefined : data.leaderUserId,
        updatedBy: session.user.id,
      },
    });
    await logAudit({
      userId: session.user.id,
      action: "team.update",
      entity: "teams",
      entityId: id,
      before,
      after,
    });
    return NextResponse.json({ ok: true });
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

export async function DELETE(req: Request, { params }: Params) {
  try {
    const session = await requirePermission("users.manage");
    const id = Number((await params).id);
    const team = await prisma.team.findUnique({
      where: { id },
      include: { _count: { select: { members: true } } },
    });
    if (!team) {
      return NextResponse.json({ error: "Team not found" }, { status: 404 });
    }
    if (team._count.members > 0) {
      return NextResponse.json(
        { error: "Team has members — reassign them before deleting" },
        { status: 400 }
      );
    }
    await prisma.team.delete({ where: { id } });
    await logAudit({
      userId: session.user.id,
      action: "team.delete",
      entity: "teams",
      entityId: id,
      before: { id: team.id, name: team.name, leaderUserId: team.leaderUserId },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
