import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requirePermission, apiError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { serializeCurrencyRate } from "@/lib/currency";

// SPEC §5 — Admin-maintained currency rate table for the customer-currency
// display on invoices. settings.manage, same gate as the other /settings pages.

const currencySchema = z.object({
  code: z
    .string()
    .trim()
    .min(2, "Code is required")
    .max(8)
    .transform((v) => v.toUpperCase()),
  name: z.string().trim().min(1, "Name is required"),
  symbol: z
    .string()
    .trim()
    .max(8)
    .optional()
    .transform((v) => (v ? v : null)),
  bdtPerUnit: z.number().positive("Rate must be greater than zero"),
  countries: z
    .array(z.string().trim().min(1))
    .max(50)
    .default([])
    // dedupe case-insensitively so matching stays unambiguous
    .transform((list) => {
      const seen = new Set<string>();
      return list.filter((c) => {
        const k = c.toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    }),
  isActive: z.boolean().default(true),
});

export async function GET() {
  try {
    await requirePermission("settings.manage");
    const rates = await prisma.currencyRate.findMany({
      orderBy: { code: "asc" },
    });
    return NextResponse.json(rates.map(serializeCurrencyRate));
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: Request) {
  try {
    const session = await requirePermission("settings.manage");
    const data = currencySchema.parse(await req.json());

    const rate = await prisma.currencyRate.create({
      data: { ...data, updatedBy: session.user.id },
    });

    await logAudit({
      userId: session.user.id,
      action: "currency_rate.create",
      entity: "currency_rates",
      entityId: rate.id,
      after: serializeCurrencyRate(rate),
    });
    return NextResponse.json(serializeCurrencyRate(rate), { status: 201 });
  } catch (e) {
    if (
      e instanceof Error &&
      "code" in e &&
      (e as { code?: string }).code === "P2002"
    ) {
      return NextResponse.json(
        { error: "A currency with this code already exists" },
        { status: 400 }
      );
    }
    return apiError(e);
  }
}
