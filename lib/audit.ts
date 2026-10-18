import type { Prisma } from "@prisma/client";
import { prisma } from "./db";

// SPEC §2.2 — every sensitive action writes who/when/before/after.
export async function logAudit(opts: {
  userId: number;
  action: string; // e.g. "user.create", "role.permissions.update"
  entity: string; // e.g. "users", "roles", "teams"
  entityId?: string | number;
  before?: unknown;
  after?: unknown;
}) {
  await prisma.auditLog.create({
    data: {
      userId: opts.userId,
      action: opts.action,
      entity: opts.entity,
      entityId: opts.entityId != null ? String(opts.entityId) : null,
      beforeJson: (opts.before ?? undefined) as Prisma.InputJsonValue | undefined,
      afterJson: (opts.after ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}

// Same row, written inside the caller's transaction — so the change and its
// audit row commit or roll back together (FUNNEL_LINER.md GV-3/GV-4).
export async function logAuditTx(
  tx: Prisma.TransactionClient,
  opts: Parameters<typeof logAudit>[0]
) {
  await tx.auditLog.create({
    data: {
      userId: opts.userId,
      action: opts.action,
      entity: opts.entity,
      entityId: opts.entityId != null ? String(opts.entityId) : null,
      beforeJson: (opts.before ?? undefined) as Prisma.InputJsonValue | undefined,
      afterJson: (opts.after ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}

// Strip secrets before an object goes into the audit log.
export function auditSafeUser<T extends { passwordHash?: string }>(u: T) {
  const { passwordHash: _passwordHash, ...rest } = u;
  return rest;
}
