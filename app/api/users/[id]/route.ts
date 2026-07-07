import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission, apiError } from "@/lib/authz";
import { logAudit, auditSafeUser } from "@/lib/audit";

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  phone: z.string().nullable().optional(),
  password: z.string().min(8).optional(), // admin reset → forces change on next login
  roleId: z.number().int().optional(),
  teamId: z.number().int().nullable().optional(),
  isActive: z.boolean().optional(),
  isOnboarding: z.boolean().optional(),
  joinedAt: z.string().nullable().optional(),
});

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Params) {
  try {
    const session = await requirePermission("users.manage");
    const id = Number((await params).id);
    const data = updateSchema.parse(await req.json());

    const before = await prisma.user.findUnique({ where: { id } });
    if (!before) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    if (data.isActive === false && id === session.user.id) {
      return NextResponse.json(
        { error: "You cannot deactivate your own account" },
        { status: 400 }
      );
    }

    const after = await prisma.user.update({
      where: { id },
      data: {
        name: data.name,
        email: data.email?.trim().toLowerCase(),
        phone: data.phone === undefined ? undefined : data.phone || null,
        roleId: data.roleId,
        teamId: data.teamId === undefined ? undefined : data.teamId,
        isActive: data.isActive,
        isOnboarding: data.isOnboarding,
        joinedAt:
          data.joinedAt === undefined
            ? undefined
            : data.joinedAt
              ? new Date(data.joinedAt)
              : null,
        ...(data.password
          ? {
              passwordHash: await bcrypt.hash(data.password, 10),
              mustChangePassword: true,
            }
          : {}),
        updatedBy: session.user.id,
      },
    });
    await logAudit({
      userId: session.user.id,
      action: data.password ? "user.update+password_reset" : "user.update",
      entity: "users",
      entityId: id,
      before: auditSafeUser(before),
      after: auditSafeUser(after),
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "A user with this email already exists" },
        { status: 409 }
      );
    }
    return apiError(e);
  }
}

// Soft delete per SPEC §2.3 — deactivate, history preserved.
export async function DELETE(req: Request, { params }: Params) {
  try {
    const session = await requirePermission("users.manage");
    const id = Number((await params).id);
    if (id === session.user.id) {
      return NextResponse.json(
        { error: "You cannot deactivate your own account" },
        { status: 400 }
      );
    }
    const before = await prisma.user.findUnique({ where: { id } });
    if (!before) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    await prisma.user.update({
      where: { id },
      data: { isActive: false, updatedBy: session.user.id },
    });
    await logAudit({
      userId: session.user.id,
      action: "user.deactivate",
      entity: "users",
      entityId: id,
      before: { isActive: before.isActive },
      after: { isActive: false },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
