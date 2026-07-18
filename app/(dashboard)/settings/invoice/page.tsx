import { requirePagePermission } from "@/lib/page-auth";
import { getInvoiceBranding } from "@/lib/settings";
import { InvoiceBrandingClient } from "@/components/settings/invoice-branding-client";

export const dynamic = "force-dynamic";

// CORRECTIONS §R9 — Business / Invoice settings: logo, address, phones,
// email/social and the invoice footer text, rendered on every newly generated
// invoice (single + bulk two-up print). Admin-only (settings.manage).
export default async function InvoiceBrandingPage() {
  await requirePagePermission("settings.manage");
  const branding = await getInvoiceBranding();
  return <InvoiceBrandingClient initial={branding} />;
}
