import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requirePermission, apiError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { serializeWallet, WALLET_TYPES } from "@/lib/wallet";

type Params = { params: Promise<{ id: string }> };

const walletInclude = {
  _count: { select: { payments: true, expenses: true } },
} as const;

const updateSchema = z.object({
  name: z.string().trim().min(1).optional(),
  type: z.enum(WALLET_TYPES).optional(),
  accountNo: z.string().trim().nullable().optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: Params) {
  try {
    const session = await requirePermission("wallets.manage");
    const id = Number((await params).id);
    const data = updateSchema.parse(await req.json());

    const before = await prisma.wallet.findUnique({
      where: { id },
      include: walletInclude,
    });
    if (!before) {
      return NextResponse.json({ error: "Wallet not found" }, { status: 404 });
    }

    const after = await prisma.wallet.update({
      where: { id },
      data: {
        name: data.name?.trim(),
        type: data.type,
        accountNo:
          data.accountNo === undefined ? undefined : data.accountNo?.trim() || null,
        isActive: data.isActive,
        updatedBy: session.user.id,
      },
      include: walletInclude,
    });

    await logAudit({
      userId: session.user.id,
      action: "wallet.update",
      entity: "wallets",
      entityId: id,
      before: serializeWallet(before),
      after: serializeWallet(after),
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (
      e instanceof Error &&
      "code" in e &&
      (e as { code?: string }).code === "P2002"
    ) {
      return NextResponse.json(
        { error: "A wallet with this name already exists" },
        { status: 400 }
      );
    }
    return apiError(e);
  }
}

export async function DELETE(req: Request, { params }: Params) {
  try {
    const session = await requirePermission("wallets.manage");
    const id = Number((await params).id);
    const wallet = await prisma.wallet.findUnique({
      where: { id },
      include: walletInclude,
    });
    if (!wallet) {
      return NextResponse.json({ error: "Wallet not found" }, { status: 404 });
    }
    // Money history references the wallet — keep it for the collection report and
    // running balance; deactivate instead of hard-deleting (matches courier rule).
    if (wallet._count.payments > 0 || wallet._count.expenses > 0) {
      return NextResponse.json(
        {
          error:
            "Wallet has payments or expenses on record — deactivate it instead so history stays intact",
        },
        { status: 400 }
      );
    }
    await prisma.wallet.delete({ where: { id } });
    await logAudit({
      userId: session.user.id,
      action: "wallet.delete",
      entity: "wallets",
      entityId: id,
      before: serializeWallet(wallet),
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
