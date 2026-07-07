import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requirePermission, apiError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";

type Params = { params: Promise<{ id: string }> };

// Returns the user's role permission keys (inherited baseline) + overrides.
export async function GET(req: Request, { params }: Params) {
  try {
    await requirePermission("users.manage");
    const id = Number((await params).id);
    const user = await prisma.user.findUnique({
      where: { id },
      include: {
        role: {
          include: { rolePermissions: { include: { permission: true } } },
        },
        overrides: { include: { permission: true } },
      },
    });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    return NextResponse.json({
      roleName: user.role.name,
      rolePermissions: user.role.rolePermissions.map((rp) => rp.permission.key),
      overrides: user.overrides.map((o) => ({
        key: o.permission.key,
        allow: o.allow,
      })),
    });
  } catch (e) {
    return apiError(e);
  }
}

const putSchema = z.object({
  overrides: z.array(z.object({ key: z.string(), allow: z.boolean() })),
});

// Replaces the full override set for the user (grant/revoke per SPEC §2).
export async function PUT(req: Request, { params }: Params) {
  try {
    const session = await requirePermission("users.manage");
    const id = Number((await params).id);
    const { overrides } = putSchema.parse(await req.json());

    const user = await prisma.user.findUnique({
      where: { id },
      include: { overrides: { include: { permission: true } } },
    });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const permissions = await prisma.permission.findMany({
      where: { key: { in: overrides.map((o) => o.key) } },
    });
    const permIdByKey = new Map(permissions.map((p) => [p.key, p.id]));
    for (const o of overrides) {
      if (!permIdByKey.has(o.key)) {
        return NextResponse.json(
          { error: `Unknown permission: ${o.key}` },
          { status: 400 }
        );
      }
    }

    await prisma.$transaction([
      prisma.userPermissionOverride.deleteMany({ where: { userId: id } }),
      prisma.userPermissionOverride.createMany({
        data: overrides.map((o) => ({
          userId: id,
          permissionId: permIdByKey.get(o.key)!,
          allow: o.allow,
        })),
      }),
    ]);

    await logAudit({
      userId: session.user.id,
      action: "user.overrides.update",
      entity: "user_permission_overrides",
      entityId: id,
      before: user.overrides.map((o) => ({
        key: o.permission.key,
        allow: o.allow,
      })),
      after: overrides,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
