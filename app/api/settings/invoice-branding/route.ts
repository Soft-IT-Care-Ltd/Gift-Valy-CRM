import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission, apiError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { getInvoiceBranding } from "@/lib/settings";
import {
  INVOICE_BRANDING_KEY,
  normalizeInvoiceBranding,
} from "@/lib/invoice-branding-constants";

// CORRECTIONS §R9 — Business / Invoice settings: the letterhead + footer every
// invoice (single and bulk two-up print) renders. Admin-only (settings.manage),
// like the other /settings pages. Newly generated invoices pick the values up
// immediately (callers load branding per render).
export async function GET() {
  try {
    await requirePermission("settings.manage");
    return NextResponse.json(await getInvoiceBranding());
  } catch (e) {
    return apiError(e);
  }
}

const bodySchema = z.object({
  logoUrl: z.string().max(300).nullable(),
  businessName: z.string().max(80),
  tagline: z.string().max(160),
  address: z.string().max(200),
  phones: z.string().max(200),
  email: z.string().max(120),
  social: z.string().max(160),
  footerText: z.string().max(600),
  thankYouLine: z.string().max(200),
});

export async function PUT(req: Request) {
  try {
    const session = await requirePermission("settings.manage");
    const before = await getInvoiceBranding();
    // normalize applies the same rules the renderer uses (trim, /uploads/-only
    // logo path, name falls back rather than going blank).
    const branding = normalizeInvoiceBranding(bodySchema.parse(await req.json()));

    await prisma.setting.upsert({
      where: { key: INVOICE_BRANDING_KEY },
      create: {
        key: INVOICE_BRANDING_KEY,
        value: branding as unknown as Prisma.InputJsonValue,
      },
      update: { value: branding as unknown as Prisma.InputJsonValue },
    });

    await logAudit({
      userId: session.user.id,
      action: "settings.update",
      entity: "settings",
      entityId: INVOICE_BRANDING_KEY,
      before,
      after: branding,
    });

    return NextResponse.json(branding);
  } catch (e) {
    return apiError(e);
  }
}
