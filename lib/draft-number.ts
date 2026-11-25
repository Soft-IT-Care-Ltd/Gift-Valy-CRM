import type { Prisma, PrismaClient } from "@prisma/client";

type Tx = Prisma.TransactionClient | PrismaClient;

// CORRECTIONS Leads §10 — drafts get a temporary DRAFT-XXXX number (one global
// sequence, last row + 1 with the caller retrying on P2002); the real GV
// number comes from generateOrderNumber at CONFIRM. Drafts are not orders yet,
// so they never touch the counter (FUNNEL_LINER.md "Defaults assumed").
// A leaf module (no next-auth, no session code): the order form route and the
// website's order endpoint (lib/storefront/place-order.ts, ROUND3 W-5) both
// number their drafts here. Re-exported from lib/orders.ts.
export const DRAFT_NO_PREFIX = "DRAFT-";

export async function nextDraftNo(db: Tx): Promise<string> {
  const last = await db.order.findFirst({
    // The OR spans both trash states ON PURPOSE: mentioning deletedAt opts out
    // of the lib/db.ts trash auto-filter. A trashed draft keeps its number
    // until the purge — hiding it here would reissue that number and the
    // unique(order_no) insert would collide forever (§6f).
    where: {
      orderNo: { startsWith: DRAFT_NO_PREFIX },
      OR: [{ deletedAt: null }, { deletedAt: { not: null } }],
    },
    orderBy: { orderNo: "desc" },
    select: { orderNo: true },
  });
  const seq = last ? parseInt(last.orderNo.slice(DRAFT_NO_PREFIX.length), 10) + 1 : 1;
  return `${DRAFT_NO_PREFIX}${String(seq).padStart(4, "0")}`;
}

export function isDraftNo(orderNo: string): boolean {
  return orderNo.startsWith(DRAFT_NO_PREFIX);
}
