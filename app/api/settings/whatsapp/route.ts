import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requirePermission, apiError, AuthzError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { encryptSecret } from "@/lib/crypto";
import {
  getWhatsAppIntegration,
  serializeWhatsAppIntegration,
} from "@/lib/whatsapp";

// Settings → WhatsApp Invoice (SPEC §5 / §16 Phase 4). Admin-only
// (settings.manage). The access token is encrypted at rest and never returned
// to the client after save (masked view only) — same rules as Steadfast keys.

export async function GET() {
  try {
    await requirePermission("settings.manage");
    return NextResponse.json(
      serializeWhatsAppIntegration(await getWhatsAppIntegration())
    );
  } catch (e) {
    return apiError(e);
  }
}

const bodySchema = z.object({
  phoneNumberId: z.string().trim().optional(),
  // Empty/omitted → keep the stored token (save toggles without re-typing it).
  accessToken: z.string().optional(),
  isEnabled: z.boolean().optional(),
  autoSendInvoice: z.boolean().optional(),
});

export async function PUT(req: Request) {
  try {
    const session = await requirePermission("settings.manage");
    const data = bodySchema.parse(await req.json());
    const existing = await getWhatsAppIntegration();

    const accessToken = data.accessToken?.trim();
    const phoneNumberId =
      data.phoneNumberId !== undefined
        ? data.phoneNumberId.trim() || null
        : undefined;

    const willHavePhone =
      phoneNumberId !== undefined ? !!phoneNumberId : !!existing?.phoneNumberId;
    const willHaveToken = accessToken ? true : !!existing?.accessTokenEncrypted;
    if (data.isEnabled && (!willHavePhone || !willHaveToken)) {
      throw new AuthzError(
        400,
        "Enter the Phone Number ID and Access Token before enabling WhatsApp sending"
      );
    }

    const values = {
      ...(phoneNumberId !== undefined ? { phoneNumberId } : {}),
      ...(accessToken ? { accessTokenEncrypted: encryptSecret(accessToken) } : {}),
      ...(data.isEnabled !== undefined ? { isEnabled: data.isEnabled } : {}),
      ...(data.autoSendInvoice !== undefined
        ? { autoSendInvoice: data.autoSendInvoice }
        : {}),
    };
    const integration = existing
      ? await prisma.whatsAppIntegration.update({
          where: { id: existing.id },
          data: values,
        })
      : await prisma.whatsAppIntegration.create({
          data: {
            phoneNumberId: phoneNumberId ?? null,
            accessTokenEncrypted: accessToken ? encryptSecret(accessToken) : null,
            isEnabled: data.isEnabled ?? false,
            autoSendInvoice: data.autoSendInvoice ?? true,
          },
        });

    await logAudit({
      userId: session.user.id,
      action: "whatsapp_integration.settings.update",
      entity: "whatsapp_integrations",
      entityId: integration.id,
      // Never log the token — only which fields changed + non-secret state.
      after: {
        isEnabled: integration.isEnabled,
        autoSendInvoice: integration.autoSendInvoice,
        phoneNumberId: integration.phoneNumberId,
        accessTokenChanged: !!accessToken,
      },
    });

    return NextResponse.json(serializeWhatsAppIntegration(integration));
  } catch (e) {
    return apiError(e);
  }
}
