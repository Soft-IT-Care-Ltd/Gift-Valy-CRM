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
  return systemUserId(tx, SYSTEM_USER_EMAIL, SYSTEM_USER_NAME);
}

// FUNNEL_LINER.md GV-3/GV-4 — audit_logs.user_id is required, and the pushes
// from Funnel Liner (billing state, billing snapshot) have no human actor.
// Same kind of inactive, non-login account as the Steadfast one; the audit JSON
// also says actor "Funnel Liner".
export const FUNNEL_LINER_USER_EMAIL = "funnelliner-system@giftvaly.local";
export const FUNNEL_LINER_USER_NAME = "Funnel Liner (system)";

export async function getFunnelLinerUserId(tx: Tx): Promise<number> {
  return systemUserId(tx, FUNNEL_LINER_USER_EMAIL, FUNNEL_LINER_USER_NAME);
}

async function systemUserId(tx: Tx, email: string, name: string): Promise<number> {
  const existing = await tx.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (existing) return existing.id;

  // Any role satisfies the FK; the account is inactive so the role grants nothing.
  const anyRole = await tx.role.findFirstOrThrow({ select: { id: true } });
  const created = await tx.user.create({
    data: {
      name,
      email,
      passwordHash: `!disabled!${crypto.randomBytes(24).toString("hex")}`,
      roleId: anyRole.id,
      isActive: false,
      mustChangePassword: false,
    },
    select: { id: true },
  });
  return created.id;
}
