import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/lib/page-auth";
import { AuditLogClient } from "@/components/admin/audit-log-client";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// SPEC §2.2 / CLAUDE.md rule 3 — the audit trail of every sensitive mutation.
// Admin-only (audit.view). Server-side filtering (entity, action, user, date) +
// pagination keep it usable as the log grows.
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{
    entity?: string;
    action?: string;
    user?: string;
    from?: string;
    to?: string;
    page?: string;
  }>;
}) {
  await requirePagePermission("audit.view");
  const sp = await searchParams;

  const page = Math.max(1, Number(sp.page) || 1);
  const where: Prisma.AuditLogWhereInput = {};
  if (sp.entity) where.entity = sp.entity;
  if (sp.action) where.action = sp.action;
  if (sp.user && /^\d+$/.test(sp.user)) where.userId = Number(sp.user);
  if (sp.from && DATE_RE.test(sp.from)) {
    where.at = { ...(where.at as object), gte: new Date(`${sp.from}T00:00:00+06:00`) };
  }
  if (sp.to && DATE_RE.test(sp.to)) {
    where.at = { ...(where.at as object), lte: new Date(`${sp.to}T23:59:59+06:00`) };
  }

  const [logs, total, entities, actions, users] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { at: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { user: { select: { name: true, email: true } } },
    }),
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      distinct: ["entity"],
      select: { entity: true },
      orderBy: { entity: "asc" },
    }),
    prisma.auditLog.findMany({
      distinct: ["action"],
      select: { action: true },
      orderBy: { action: "asc" },
    }),
    prisma.user.findMany({
      where: { auditLogs: { some: {} } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const rows = logs.map((l) => ({
    id: l.id,
    at: l.at.toISOString(),
    userName: l.user.name,
    userEmail: l.user.email,
    action: l.action,
    entity: l.entity,
    entityId: l.entityId,
    beforeJson: l.beforeJson as unknown,
    afterJson: l.afterJson as unknown,
  }));

  return (
    <AuditLogClient
      rows={rows}
      total={total}
      page={page}
      pageSize={PAGE_SIZE}
      entities={entities.map((e) => e.entity)}
      actions={actions.map((a) => a.action)}
      users={users}
      filters={{
        entity: sp.entity ?? "",
        action: sp.action ?? "",
        user: sp.user ?? "",
        from: sp.from ?? "",
        to: sp.to ?? "",
      }}
    />
  );
}
