import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { requireUser, apiError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";

const schema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, "New password must be at least 8 characters"),
});

export async function POST(req: Request) {
  try {
    const session = await requireUser();
    const { currentPassword, newPassword } = schema.parse(await req.json());

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
    });
    if (!user || !user.isActive) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) {
      return NextResponse.json(
        { error: "Current password is incorrect" },
        { status: 400 }
      );
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await bcrypt.hash(newPassword, 10),
        mustChangePassword: false,
        updatedBy: session.user.id,
      },
    });
    await logAudit({
      userId: session.user.id,
      action: "user.change_password",
      entity: "users",
      entityId: user.id,
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
