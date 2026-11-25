import type { Prisma, PrismaClient } from "@prisma/client";

// ROUND3 W-6 — the bell in the ERP header. A row per person per event, written
// inside the transaction that caused it (so a rolled-back order rings nobody).
// No push, no e-mail: the header shows the unread count, the list opens on a
// click and marks what was shown as read.

type Db = Prisma.TransactionClient | PrismaClient;

export type NotificationInput = {
  userId: number;
  kind: string;
  title: string;
  body?: string | null;
  href?: string | null;
  /** Same key twice = one row (a retried write never rings twice). */
  dedupeKey?: string | null;
};

export async function notify(db: Db, rows: NotificationInput[]): Promise<void> {
  if (rows.length === 0) return;
  await db.notification.createMany({ data: rows, skipDuplicates: true });
}

export type NotificationView = {
  id: number;
  kind: string;
  title: string;
  body: string | null;
  href: string | null;
  read: boolean;
  at: string;
};

export async function listNotifications(db: Db, userId: number, take = 20): Promise<NotificationView[]> {
  const rows = await db.notification.findMany({
    where: { userId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take,
    select: { id: true, kind: true, title: true, body: true, href: true, readAt: true, createdAt: true },
  });
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    title: r.title,
    body: r.body,
    // Only links inside the app — a row can never send someone off-site.
    href: r.href && r.href.startsWith("/") && !r.href.startsWith("//") ? r.href : null,
    read: r.readAt !== null,
    at: r.createdAt.toISOString(),
  }));
}

export async function unreadNotificationCount(db: Db, userId: number): Promise<number> {
  return db.notification.count({ where: { userId, readAt: null } });
}

/** Marks the given rows (or all) as read — only the person's own. */
export async function markNotificationsRead(db: Db, userId: number, ids?: number[]): Promise<number> {
  const res = await db.notification.updateMany({
    where: { userId, readAt: null, ...(ids ? { id: { in: ids } } : {}) },
    data: { readAt: new Date() },
  });
  return res.count;
}
