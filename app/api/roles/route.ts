import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission, apiError } from "@/lib/authz";

export async function GET() {
  try {
    await requirePermission("users.manage");
    const roles = await prisma.role.findMany({
      orderBy: { id: "asc" },
      include: { rolePermissions: { include: { permission: true } } },
    });
    return NextResponse.json(
      roles.map((r) => ({
        id: r.id,
        name: r.name,
        permissionKeys: r.rolePermissions.map((rp) => rp.permission.key),
      }))
    );
  } catch (e) {
    return apiError(e);
  }
}
