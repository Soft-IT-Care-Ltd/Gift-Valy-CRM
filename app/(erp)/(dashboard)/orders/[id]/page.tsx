import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/lib/page-auth";
import { getEffectivePermissions } from "@/lib/rbac";
import { canSeeCosts } from "@/lib/catalog";
import {
  getOrderEditWindowMinutes,
  getCourierOverchargeTolerancePct,
  getCourierStuckThresholds,
  getPrintSettings,
} from "@/lib/settings";
import {
  orderDetailInclude,
  orderScopeWhere,
  serializeOrderDetail,
  statusChangePermitted,
  withinEditWindow,
} from "@/lib/orders";
import {
  ALLOWED_TRANSITIONS,
  EDITABLE_STATUSES,
} from "@/lib/order-constants";
import { COURIER_STAGE_STATUSES } from "@/lib/courier-constants";
import { getWhatsAppIntegration } from "@/lib/whatsapp";
import { getCurrencyForCountry } from "@/lib/currency";
import { OrderDetailClient } from "@/components/orders/order-detail-client";
import { OrderPrintKits } from "@/components/orders/print/order-print-kits";
import { loadKitViews } from "@/lib/print-kit-ops";
import { orderPrintStatus } from "@/lib/print-kit";
import { PRINT_LAYOUTS } from "@/lib/print-layouts";
import { canEditPrintAt } from "@/lib/print-access";

export const dynamic = "force-dynamic";

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requirePagePermission("orders.view_own");
  const permissions = await getEffectivePermissions(session.user.id);
  const id = Number((await params).id);
  if (!id) notFound();

  const scope = await orderScopeWhere(session, permissions);
  const order = await prisma.order.findFirst({
    where: { AND: [{ id }, scope] },
    include: orderDetailInclude,
  });
  if (!order) notFound();

  // Active wallets for the "record payment" dialog — every payment records its
  // receiving account (SPEC §8). Anyone who can add a payment needs the list.
  const wallets = permissions.includes("payments.create")
    ? await prisma.wallet.findMany({
        where: { isActive: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true, type: true },
      })
    : [];

  // §4.2 edit rule: privileged roles edit anytime (while editable); the
  // creator edits inside the window, then must request approval.
  const editWindowMinutes = await getOrderEditWindowMinutes();
  const privileged =
    permissions.includes("orders.edit") ||
    permissions.includes("orders.approve_edit");
  const isCreator = order.salesExecutiveId === session.user.id;
  const inWindow = withinEditWindow(order.createdAt, editWindowMinutes);
  const editableStatus = EDITABLE_STATUSES.includes(order.status);

  const canEdit = editableStatus && (privileged || (isCreator && inWindow));
  const canRequestEdit = editableStatus && isCreator && !inWindow && !privileged;
  const editBlockedReason =
    editableStatus && isCreator && !inWindow && !privileged
      ? `Edit window (${editWindowMinutes} min) has expired — changes need TL/Manager approval.`
      : null;

  // Courier-stage moves (handover → transit → delivered/returned) belong to the
  // Courier module (a shipment is the single source of truth), so they are not
  // offered as generic status buttons here (SPEC §7).
  const allowedTransitions = ALLOWED_TRANSITIONS[order.status].filter(
    (to) =>
      statusChangePermitted(to, permissions) &&
      !COURIER_STAGE_STATUSES.includes(to)
  );

  // SPEC §5 / §16 Phase 4 — WhatsApp API availability for the send button, and
  // the customer-currency rate for the pre-filled message's approx lines.
  // CORRECTIONS Orders §R7 — the courier block shows Ours-vs-Steadfast with the
  // same overcharge highlight (tolerance) and stuck-duration escalation as the
  // In Transit tab.
  const showCosts = canSeeCosts(permissions);
  // PHOTO_PRINT PP-4 — the order's photo/card kits (print.edit / print.print).
  const canSeePrint = permissions.includes("print.edit") || permissions.includes("print.print");
  const [printKits, printSettings, printStatus] = canSeePrint
    ? await Promise.all([loadKitViews(order.id), getPrintSettings(), loadOrderPrintStatus(order.id)])
    : [[], null, null];
  const printSizes = printSettings?.sizes ?? null;
  const [waIntegration, currency, overchargeTolerancePct, stuckThresholds] =
    await Promise.all([
      getWhatsAppIntegration(),
      getCurrencyForCountry(order.customer.country),
      getCourierOverchargeTolerancePct(),
      getCourierStuckThresholds(),
    ]);

  return (
    <OrderDetailClient
      order={serializeOrderDetail(order, showCosts)}
      canEdit={canEdit}
      editBlockedReason={editBlockedReason}
      canRequestEdit={canRequestEdit}
      canAddPayment={permissions.includes("payments.create")}
      canVerifyPayment={permissions.includes("payments.verify")}
      canApprove={permissions.includes("orders.approve_edit")}
      allowedTransitions={allowedTransitions}
      wallets={wallets}
      waApiEnabled={!!waIntegration?.isEnabled}
      currency={currency}
      showCosts={showCosts}
      overchargeTolerancePct={overchargeTolerancePct}
      stuckAmberDays={stuckThresholds.amberDays}
      stuckRedDays={stuckThresholds.redDays}
      nowMs={Date.now()}
      printSection={
        printKits.length > 0 && printSizes ? (
          <OrderPrintKits
            initialKits={printKits}
            sizes={printSizes}
            canEdit={canEditPrintAt(order.status, permissions)}
            canDeleteKit={permissions.includes("orders.edit") && permissions.includes("print.edit")}
            locked={permissions.includes("print.edit") && !canEditPrintAt(order.status, permissions)}
            print={
              printStatus && printSettings
                ? {
                    orderId: order.id,
                    orderNo: order.orderNo,
                    status: printStatus,
                    canPrint: permissions.includes("print.print"),
                    borderless: PRINT_LAYOUTS[printSettings.layout].borderless,
                  }
                : undefined
            }
          />
        ) : null
      }
    />
  );
}

/** PP-7 — the print state + who printed last, for the order page's print bar. */
async function loadOrderPrintStatus(orderId: number) {
  const kits = await prisma.orderPrintKit.findMany({
    where: { orderId },
    select: {
      status: true,
      photoCount: true,
      cardCount: true,
      spec: true,
      orphanedAt: true,
      printedAt: true,
      printCount: true,
      printedBy: true,
    },
  });
  const ids = [...new Set(kits.map((k) => k.printedBy).filter((v): v is number => v != null))];
  const users = ids.length
    ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
    : [];
  const names = new Map(users.map((u) => [u.id, u.name]));
  return orderPrintStatus(kits, (id) => names.get(id) ?? null);
}
