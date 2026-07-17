import path from "path";
import { readFile } from "fs/promises";
import type {
  WhatsAppIntegration,
  WhatsAppMessage,
  WhatsAppTrigger,
} from "@prisma/client";
import { prisma } from "./db";
import { AuthzError } from "./authz";
import { decryptSecret, maskSecret } from "./crypto";
import { logAudit } from "./audit";
import {
  loadInvoiceOrder,
  renderInvoicePdf,
  invoiceFileName,
  type InvoiceOrder,
} from "./invoice";
import { getCurrencyForCountry } from "./currency";
import { buildInvoiceMessage } from "./invoice-message";

// ============ WhatsApp invoice send (SPEC §5 / §16 Phase 4) ============
//
// Meta WhatsApp Cloud API: upload the invoice PDF as media, then send it as a
// document message to the customer's foreign number. Two entry points:
//   - autoSendInvoiceWhatsAppSafe — fired after an invoice is generated
//     (order confirm / approved edit); never throws into the order flow.
//   - sendInvoiceViaWhatsApp(MANUAL) — the "Send via WhatsApp" button.
// Every attempt (sent or failed) is a whatsapp_messages row, so the order page
// and settings log always show what actually reached the customer.
//
// Caveat baked into error text below: outside the 24-hour customer-service
// window the Cloud API rejects free-form messages (template-only). Gift Valy
// customers normally order over WhatsApp minutes earlier, so the window is
// almost always open; when it isn't, the SE falls back to the wa.me link.

const GRAPH_BASE = "https://graph.facebook.com/v21.0";

interface WhatsAppCreds {
  phoneNumberId: string;
  accessToken: string;
}

// Singleton row (first row wins; the settings route only ever writes one).
export async function getWhatsAppIntegration(): Promise<WhatsAppIntegration | null> {
  return prisma.whatsAppIntegration.findFirst({ orderBy: { id: "asc" } });
}

export function credsFromWhatsAppIntegration(
  integration: WhatsAppIntegration | null
): WhatsAppCreds {
  if (!integration?.phoneNumberId || !integration?.accessTokenEncrypted) {
    throw new AuthzError(
      400,
      "WhatsApp API is not configured — add the Phone Number ID and Access Token in Settings"
    );
  }
  return {
    phoneNumberId: integration.phoneNumberId,
    accessToken: decryptSecret(integration.accessTokenEncrypted),
  };
}

// The masked, secret-free view for the settings page (token never leaves the
// server after save — same rule as the Steadfast keys).
export function serializeWhatsAppIntegration(
  integration: WhatsAppIntegration | null
) {
  return {
    configured: !!(
      integration?.phoneNumberId && integration?.accessTokenEncrypted
    ),
    isEnabled: integration?.isEnabled ?? false,
    autoSendInvoice: integration?.autoSendInvoice ?? true,
    phoneNumberId: integration?.phoneNumberId ?? "",
    accessTokenMasked: integration?.accessTokenEncrypted
      ? maskSecret(safeDecrypt(integration.accessTokenEncrypted))
      : null,
    connectedAt: integration?.connectedAt?.toISOString() ?? null,
    lastSentAt: integration?.lastSentAt?.toISOString() ?? null,
  };
}

function safeDecrypt(value: string): string {
  try {
    return decryptSecret(value);
  } catch {
    return "";
  }
}

// ---------- Graph API ----------

type GraphErrorBody = {
  error?: { message?: string; code?: number; error_subcode?: number };
};

function graphErrorMessage(body: GraphErrorBody, status: number): string {
  const err = body.error;
  // 131047 / 131026: outside the 24h customer-service window — the one
  // failure SEs will actually hit, so give it an actionable message.
  if (err?.code === 131047 || err?.error_subcode === 131047 || err?.code === 131026) {
    return "WhatsApp rejected the message: the customer hasn't messaged this number in the last 24 hours. Ask them to send any message first, or use the chat link to send the PDF yourself.";
  }
  return err?.message
    ? `${err.message}${err.code ? ` (code ${err.code})` : ""}`
    : `WhatsApp API error (HTTP ${status})`;
}

async function graphUploadPdf(
  creds: WhatsAppCreds,
  pdf: Buffer,
  fileName: string
): Promise<string> {
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", "application/pdf");
  form.append(
    "file",
    new Blob([new Uint8Array(pdf)], { type: "application/pdf" }),
    fileName
  );
  const res = await fetch(`${GRAPH_BASE}/${creds.phoneNumberId}/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${creds.accessToken}` },
    body: form,
  });
  const body = (await res.json().catch(() => ({}))) as GraphErrorBody & {
    id?: string;
  };
  if (!res.ok || !body.id) throw new Error(graphErrorMessage(body, res.status));
  return body.id;
}

async function graphSendDocument(
  creds: WhatsAppCreds,
  to: string,
  mediaId: string,
  caption: string,
  fileName: string
): Promise<string | null> {
  const res = await fetch(`${GRAPH_BASE}/${creds.phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${creds.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "document",
      document: { id: mediaId, caption, filename: fileName },
    }),
  });
  const body = (await res.json().catch(() => ({}))) as GraphErrorBody & {
    messages?: { id: string }[];
  };
  if (!res.ok) throw new Error(graphErrorMessage(body, res.status));
  return body.messages?.[0]?.id ?? null;
}

// Settings "Test connection": reads the phone number's own profile — proves
// the token + phone number id pair works without messaging anyone.
export async function testWhatsAppConnection(): Promise<{
  verifiedName: string | null;
  displayPhoneNumber: string | null;
}> {
  const integration = await getWhatsAppIntegration();
  const creds = credsFromWhatsAppIntegration(integration);
  const res = await fetch(
    `${GRAPH_BASE}/${creds.phoneNumberId}?fields=verified_name,display_phone_number`,
    { headers: { Authorization: `Bearer ${creds.accessToken}` } }
  );
  const body = (await res.json().catch(() => ({}))) as GraphErrorBody & {
    verified_name?: string;
    display_phone_number?: string;
  };
  if (!res.ok) throw new AuthzError(400, graphErrorMessage(body, res.status));
  await prisma.whatsAppIntegration.update({
    where: { id: integration!.id },
    data: { connectedAt: new Date() },
  });
  return {
    verifiedName: body.verified_name ?? null,
    displayPhoneNumber: body.display_phone_number ?? null,
  };
}

// ---------- Sending ----------

function messageOrderInput(order: InvoiceOrder) {
  return {
    orderNo: order.orderNo,
    customerName: order.customer.name,
    totalAmount: Number(order.totalAmount),
    advanceAmount: Number(order.advanceAmount),
    dueAmount: Number(order.dueAmount),
    recipientName: order.recipientName,
    district: order.district,
  };
}

export async function sendInvoiceViaWhatsApp(
  orderId: number,
  opts: { trigger: WhatsAppTrigger; userId?: number }
): Promise<WhatsAppMessage> {
  const integration = await getWhatsAppIntegration();
  if (!integration?.isEnabled) {
    throw new AuthzError(400, "WhatsApp integration is not enabled in Settings");
  }
  const creds = credsFromWhatsAppIntegration(integration);

  const order = await loadInvoiceOrder(orderId);
  const invoice = await prisma.invoice.findFirst({
    where: { orderId },
    orderBy: { version: "desc" },
  });
  if (!invoice) {
    throw new AuthzError(400, "No invoice has been generated for this order yet");
  }

  const to = order.customer.phoneForeign.replace(/\D/g, "");
  if (to.length < 8) {
    throw new AuthzError(
      400,
      `Customer phone "${order.customer.phoneForeign}" doesn't look like a valid WhatsApp number`
    );
  }

  const currency = await getCurrencyForCountry(order.customer.country);
  const fileName = invoiceFileName(order.orderNo, invoice.version);
  // Latest version mirrors current order data, so a lost file can be
  // re-rendered — same fallback as the download route.
  let pdf: Buffer;
  try {
    pdf = await readFile(path.join(process.cwd(), invoice.pdfUrl));
  } catch {
    pdf = await renderInvoicePdf(order, invoice.version, currency);
  }
  const caption = buildInvoiceMessage(messageOrderInput(order), currency);

  const base = {
    orderId,
    invoiceId: invoice.id,
    toPhone: to,
    trigger: opts.trigger,
    sentBy: opts.userId ?? null,
  };

  try {
    const mediaId = await graphUploadPdf(creds, pdf, fileName);
    const waMessageId = await graphSendDocument(creds, to, mediaId, caption, fileName);
    const [message] = await prisma.$transaction([
      prisma.whatsAppMessage.create({
        data: { ...base, status: "SENT", waMessageId },
      }),
      prisma.whatsAppIntegration.update({
        where: { id: integration.id },
        data: { lastSentAt: new Date() },
      }),
    ]);
    if (opts.userId) {
      await logAudit({
        userId: opts.userId,
        action: "invoice.whatsapp_send",
        entity: "whatsapp_messages",
        entityId: message.id,
        after: { orderNo: order.orderNo, version: invoice.version, to },
      });
    }
    return message;
  } catch (err) {
    const reason =
      err instanceof Error ? err.message : "Unknown WhatsApp send error";
    await prisma.whatsAppMessage.create({
      data: { ...base, status: "FAILED", error: reason.slice(0, 500) },
    });
    throw new AuthzError(502, `WhatsApp send failed: ${reason}`);
  }
}

// Post-invoice-generation hook (order confirm / approved edit). Auto-send is
// best-effort by design: the order/edit has already succeeded, and the FAILED
// whatsapp_messages row + order-page status keep the miss visible.
export async function autoSendInvoiceWhatsAppSafe(
  orderId: number,
  trigger: WhatsAppTrigger
): Promise<void> {
  try {
    const integration = await getWhatsAppIntegration();
    if (!integration?.isEnabled || !integration.autoSendInvoice) return;
    await sendInvoiceViaWhatsApp(orderId, { trigger });
  } catch (err) {
    console.error(`WhatsApp auto-send failed for order ${orderId}:`, err);
  }
}
