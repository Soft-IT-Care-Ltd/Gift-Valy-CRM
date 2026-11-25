import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/lib/page-auth";
import {
  getWhatsAppIntegration,
  serializeWhatsAppIntegration,
} from "@/lib/whatsapp";
import {
  WhatsAppSettingsClient,
  type WhatsAppLogRow,
} from "@/components/settings/whatsapp-settings-client";

export const dynamic = "force-dynamic";

// Settings → WhatsApp Invoice (SPEC §5 / §16 Phase 4). Admin-only
// (settings.manage).
export default async function WhatsAppSettingsPage() {
  await requirePagePermission("settings.manage");

  const [integration, messages] = await Promise.all([
    getWhatsAppIntegration(),
    prisma.whatsAppMessage.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { order: { select: { orderNo: true } } },
    }),
  ]);

  // sent_by has no FK relation — resolve the few names in one query.
  const senderIds = [
    ...new Set(messages.map((m) => m.sentBy).filter((v): v is number => !!v)),
  ];
  const senders = senderIds.length
    ? await prisma.user.findMany({
        where: { id: { in: senderIds } },
        select: { id: true, name: true },
      })
    : [];
  const nameById = new Map(senders.map((u) => [u.id, u.name]));

  const logs: WhatsAppLogRow[] = messages.map((m) => ({
    id: m.id,
    orderId: m.orderId,
    orderNo: m.order.orderNo,
    toPhone: m.toPhone,
    trigger: m.trigger,
    status: m.status,
    error: m.error,
    sentByName: m.sentBy ? nameById.get(m.sentBy) ?? null : null,
    createdAt: m.createdAt.toISOString(),
  }));

  return (
    <WhatsAppSettingsClient
      initial={serializeWhatsAppIntegration(integration)}
      logs={logs}
    />
  );
}
