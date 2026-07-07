import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission, apiError } from "@/lib/authz";
import { logAudit, auditSafeUser } from "@/lib/audit";

export async function GET() {
  try {
    await requirePermission("users.manage");
    const users = await prisma.user.findMany({
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      include: {
        role: true,
        team: true,
        _count: { select: { overrides: true } },
      },
    });
    return NextResponse.json(
      users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        phone: u.phone,
        roleId: u.roleId,
        roleName: u.role.name,
        teamId: u.teamId,
        teamName: u.team?.name ?? null,
        isActive: u.isActive,
        isOnboarding: u.isOnboarding,
        mustChangePassword: u.mustChangePassword,
        joinedAt: u.joinedAt?.toISOString().slice(0, 10) ?? null,
        overridesCount: u._count.overrides,
      }))
    );
  } catch (e) {
    return apiError(e);
  }
}

const createSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional().nullable(),
  password: z.string().min(8),
  roleId: z.number().int(),
  teamId: z.number().int().nullable().optional(),
  isOnboarding: z.boolean().optional().default(false),
  joinedAt: z.string().optional().nullable(), // YYYY-MM-DD
  mustChangePassword: z.boolean().optional().default(true),
});

export async function POST(req: Request) {
  try {
    const session = await requirePermission("users.manage");
    const data = createSchema.parse(await req.json());

    const user = await prisma.user.create({
      data: {
        name: data.name,
        email: data.email.trim().toLowerCase(),
        phone: data.phone || null,
        passwordHash: await bcrypt.hash(data.password, 10),
        roleId: data.roleId,
        teamId: data.teamId ?? null,
        isOnboarding: data.isOnboarding,
        mustChangePassword: data.mustChangePassword,
        joinedAt: data.joinedAt ? new Date(data.joinedAt) : new Date(),
        createdBy: session.user.id,
        updatedBy: session.user.id,
      },
    });
    await logAudit({
      userId: session.user.id,
      action: "user.create",
      entity: "users",
      entityId: user.id,
      after: auditSafeUser(user),
    });
    return NextResponse.json({ id: user.id }, { status: 201 });
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
