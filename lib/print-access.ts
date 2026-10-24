import type { Session } from "next-auth";
import { prisma } from "./db";
import { AuthzError, requireUser } from "./authz";
import { getEffectivePermissions } from "./rbac";
import { orderScopeWhere, orderViewScope } from "./orders";
import type { OrderStatusValue } from "./order-constants";

// ============ PHOTO_PRINT.md PP-5 — who may see / change a kit ============
//
//   see    print.print (Packing — every order), or print.edit within the
//          person's order scope (an SE: own orders only)
//   change print.edit within scope, only until the order is PACKED;
//          orders.edit (Admin + Manager) may change at any status

/** Statuses before PACKED — the SE may still change photos and cards. */
export const PRINT_EDITABLE_STATUSES: OrderStatusValue[] = [
  "DRAFT",
  "LEAD",
  "FOLLOW_UP",
  "CONFIRMED",
  "ON_HOLD",
];

export function canEditPrintAt(status: OrderStatusValue, permissions: string[]): boolean {
  if (!permissions.includes("print.edit")) return false;
  return PRINT_EDITABLE_STATUSES.includes(status) || permissions.includes("orders.edit");
}

export interface PrintCtx {
  session: Session;
  permissions: string[];
}

export async function requirePrintCtx(): Promise<PrintCtx> {
  const session = await requireUser();
  const permissions = await getEffectivePermissions(session.user.id);
  if (!permissions.includes("print.edit") && !permissions.includes("print.print")) {
    throw new AuthzError(403, "Missing permission: print.edit");
  }
  return { session, permissions };
}

/** The order if this person may SEE its kits, else null. */
export async function printReadableOrder(ctx: PrintCtx, orderId: number) {
  if (ctx.permissions.includes("print.print")) {
    return prisma.order.findUnique({ where: { id: orderId }, select: { id: true, status: true, orderNo: true } });
  }
  if (!ctx.permissions.includes("print.edit") || !orderViewScope(ctx.permissions)) return null;
  const scope = await orderScopeWhere(ctx.session, ctx.permissions);
  return prisma.order.findFirst({
    where: { AND: [{ id: orderId }, scope] },
    select: { id: true, status: true, orderNo: true },
  });
}

/** Loads a kit the person may CHANGE, or throws 403/404 with a clear reason. */
export async function requireEditableKit(ctx: PrintCtx, kitId: number) {
  const kit = await prisma.orderPrintKit.findUnique({
    where: { id: kitId },
    select: { id: true, orderId: true, spec: true, status: true },
  });
  if (!kit) throw new AuthzError(404, "Kit not found");
  const order = await printReadableOrder(ctx, kit.orderId);
  if (!order) throw new AuthzError(404, "Kit not found");
  if (!canEditPrintAt(order.status, ctx.permissions)) {
    throw new AuthzError(
      403,
      ctx.permissions.includes("print.edit")
        ? "অর্ডার প্যাক হয়ে গেছে — ছবি/কার্ড বদলাতে Manager লাগবে / The order is packed — only Admin/Manager can change photos and cards now"
        : "Missing permission: print.edit"
    );
  }
  return { kit, order };
}
