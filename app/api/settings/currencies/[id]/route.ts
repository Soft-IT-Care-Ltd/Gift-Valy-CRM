import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requirePermission, apiError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { serializeCurrencyRate } from "@/lib/currency";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(8)
    .transform((v) => v.toUpperCase())
    .optional(),
  name: z.string().trim().min(1).optional(),
  symbol: z
    .string()
    .trim()
    .max(8)
    .nullish()
    // absent → leave unchanged; "" or null → clear
    .transform((v) => (v === undefined ? undefined : v ? v : null)),
  bdtPerUnit: z.number().positive().optional(),
  countries: z
    .array(z.string().trim().min(1))
    .max(50)
    .optional()
    .transform((list) => {
      if (!list) return undefined;
      const seen = new Set<string>();
      return list.filter((c) => {
        const k = c.toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    }),
  isActive: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: Params) {
  try {
    const session = await requirePermission("settings.manage");
    const id = Number((await params).id);
    const existing = await prisma.currencyRate.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Currency not found" }, { status: 404 });
    }
    const data = patchSchema.parse(await req.json());

    const rate = await prisma.currencyRate.update({
      where: { id },
      data: { ...data, updatedBy: session.user.id },
    });

    await logAudit({
      userId: session.user.id,
      action: "currency_rate.update",
      entity: "currency_rates",
      entityId: id,
      before: serializeCurrencyRate(existing),
      after: serializeCurrencyRate(rate),
    });
    return NextResponse.json(serializeCurrencyRate(rate));
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

export async function DELETE(_req: Request, { params }: Params) {
  try {
    const session = await requirePermission("settings.manage");
    const id = Number((await params).id);
    const existing = await prisma.currencyRate.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Currency not found" }, { status: 404 });
    }
    await prisma.currencyRate.delete({ where: { id } });
    await logAudit({
      userId: session.user.id,
      action: "currency_rate.delete",
      entity: "currency_rates",
      entityId: id,
      before: serializeCurrencyRate(existing),
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
