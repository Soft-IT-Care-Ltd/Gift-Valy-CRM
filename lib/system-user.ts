import type { Prisma, PrismaClient } from "@prisma/client";
import crypto from "crypto";

type Tx = Prisma.TransactionClient | PrismaClient;

// order_status_history.by_user is a required FK, but webhook/poll updates have no
// human actor (STEADFAST_INTEGRATION.md §3B step 5: "by_user = system"). We use a
// dedicated, non-login system user so those history rows attribute cleanly.
//
// The account is is_active = false (getEffectivePermissions returns [] and login
// is blocked) with a random unusable password, so it can never be signed into or
// carry permissions — it exists only to satisfy the FK and label automated moves.
export const SYSTEM_USER_EMAIL = "steadfast-system@giftvaly.local";
export const SYSTEM_USER_NAME = "Steadfast (system)";

export async function getSystemUserId(tx: Tx): Promise<number> {
  const existing = await tx.user.findUnique({
    where: { email: SYSTEM_USER_EMAIL },
    select: { id: true },
  });
  if (existing) return existing.id;

  // Any role satisfies the FK; the account is inactive so the role grants nothing.
  const anyRole = await tx.role.findFirstOrThrow({ select: { id: true } });
  const created = await tx.user.create({
    data: {
      name: SYSTEM_USER_NAME,
      email: SYSTEM_USER_EMAIL,
      passwordHash: `!disabled!${crypto.randomBytes(24).toString("hex")}`,
      roleId: anyRole.id,
      isActive: false,
      mustChangePassword: false,
    },
    select: { id: true },
  });
  return created.id;
}
