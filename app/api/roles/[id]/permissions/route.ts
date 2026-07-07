import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requirePermission, apiError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";

type Params = { params: Promise<{ id: string }> };

const putSchema = z.object({ keys: z.array(z.string()) });

// Replaces a role's permission set (Admin permission-matrix UI, SPEC §2).
export async function PUT(req: Request, { params }: Params) {
  try {
    const session = await requirePermission("users.manage");
    const id = Number((await params).id);
    const { keys } = putSchema.parse(await req.json());

    const role = await prisma.role.findUnique({
      where: { id },
      include: { rolePermissions: { include: { permission: true } } },
    });
    if (!role) {
      return NextResponse.json({ error: "Role not found" }, { status: 404 });
    }
    if (role.name === "Admin") {
      return NextResponse.json(
        { error: "The Admin role always has all permissions" },
        { status: 400 }
      );
    }

    const permissions = await prisma.permission.findMany({
      where: { key: { in: keys } },
    });
    if (permissions.length !== new Set(keys).size) {
      return NextResponse.json(
        { error: "Unknown permission key in payload" },
        { status: 400 }
      );
    }

    await prisma.$transaction([
      prisma.rolePermission.deleteMany({ where: { roleId: id } }),
      prisma.rolePermission.createMany({
        data: permissions.map((p) => ({ roleId: id, permissionId: p.id })),
      }),
    ]);

    await logAudit({
      userId: session.user.id,
      action: "role.permissions.update",
      entity: "roles",
      entityId: id,
      before: role.rolePermissions.map((rp) => rp.permission.key).sort(),
      after: [...keys].sort(),
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
