import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requirePermission, apiError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { serializeWallet, WALLET_TYPES } from "@/lib/wallet";

// SPEC §8 / §14 — company receiving accounts (bKash/Nagad/Rocket/Bank/Cash).
const walletInclude = {
  _count: { select: { payments: true, expenses: true } },
} as const;

const createSchema = z.object({
  name: z.string().trim().min(1, "Wallet name is required"),
  type: z.enum(WALLET_TYPES),
  accountNo: z
    .string()
    .nullable()
    .optional()
    .transform((v) => (v?.trim() ? v.trim() : null)),
  isActive: z.boolean().default(true),
});

export async function GET() {
  try {
    await requirePermission("wallets.manage");
    const wallets = await prisma.wallet.findMany({
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      include: walletInclude,
    });
    return NextResponse.json(wallets.map(serializeWallet));
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: Request) {
  try {
    const session = await requirePermission("wallets.manage");
    const data = createSchema.parse(await req.json());

    const wallet = await prisma.wallet.create({
      data: {
        name: data.name,
        type: data.type,
        accountNo: data.accountNo,
        isActive: data.isActive,
        createdBy: session.user.id,
        updatedBy: session.user.id,
      },
      include: walletInclude,
    });

    await logAudit({
      userId: session.user.id,
      action: "wallet.create",
      entity: "wallets",
      entityId: wallet.id,
      after: serializeWallet(wallet),
    });
    return NextResponse.json({ id: wallet.id }, { status: 201 });
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
