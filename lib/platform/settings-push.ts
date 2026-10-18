import type { Prisma } from "@prisma/client";
import { logAuditTx } from "@/lib/audit";
import { getFunnelLinerUserId } from "@/lib/system-user";
import { FUNNEL_LINER_ACTOR, isNewerPush } from "./state-shape";
import { withTx, type Db } from "./tx";

// FUNNEL_LINER.md GV-3/GV-4 — how a push from Funnel Liner is stored: in the
// `settings` row `key`, row-locked (two pushes arriving together are judged
// one after the other), ignored when older than the stored one, and written
// with its audit row (user = the Funnel Liner system user, actor "Funnel
// Liner" in the JSON) in one transaction.
export async function applySettingsPush<T extends { sentAt: string | null }>(
  db: Db,
  opts: {
    key: string;
    action: string;
    pushSentAt: string;
    /** The stored value as it is now (already parsed). */
    parse: (raw: unknown) => T | null;
    /** What to store, given what is stored now. */
    build: (before: T | null) => T;
  }
): Promise<{ applied: boolean; value: T | null }> {
  return withTx(db, async (tx) => {
    await tx.$executeRaw`INSERT INTO settings (key, value) VALUES (${opts.key}, 'null'::jsonb) ON CONFLICT (key) DO NOTHING`;
    const [row] = await tx.$queryRaw<{ value: unknown }[]>`SELECT value FROM settings WHERE key = ${opts.key} FOR UPDATE`;
    const before = opts.parse(row?.value ?? null);
    if (!isNewerPush(before?.sentAt, opts.pushSentAt)) return { applied: false, value: before };

    const after = opts.build(before);
    await tx.setting.update({
      where: { key: opts.key },
      data: { value: after as unknown as Prisma.InputJsonValue },
    });
    await logAuditTx(tx, {
      userId: await getFunnelLinerUserId(tx),
      action: opts.action,
      entity: "platform",
      entityId: opts.key,
      before: { actor: FUNNEL_LINER_ACTOR, value: before },
      after: { actor: FUNNEL_LINER_ACTOR, value: after },
    });
    return { applied: true, value: after };
  });
}
