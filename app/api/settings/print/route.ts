import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requirePermission, apiError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { SETTING_KEYS, getPrintSettings } from "@/lib/settings";
import {
  PRINT_LAYOUTS,
  PRINT_LAYOUT_IDS,
  PRINT_SIZE_MAX_MM,
  PRINT_SIZE_MIN_MM,
  checkLayout,
  type PrintSettings,
} from "@/lib/print-layouts";

// PHOTO_PRINT.md PP-1 — Settings → Gift print: the four piece sizes (mm, one
// decimal) and the A4 layout. Admin only (settings.manage). A save that makes
// the CHOSEN layout overlap or run off the page is refused with the exact
// pieces and millimetres; problems in the other layout come back as warnings.
export async function GET() {
  try {
    await requirePermission("settings.manage");
    return NextResponse.json(await getPrintSettings());
  } catch (e) {
    return apiError(e);
  }
}

const mm = z
  .number()
  .min(PRINT_SIZE_MIN_MM)
  .max(PRINT_SIZE_MAX_MM)
  .transform((v) => Math.round(v * 10) / 10);
const size = z.object({ w: mm, h: mm });

const schema = z.object({
  sizes: z.object({ PHOTO_L: size, PHOTO_S: size, CARD_1: size, CARD_2: size }),
  layout: z.enum(PRINT_LAYOUT_IDS),
});

export async function PUT(req: Request) {
  try {
    const session = await requirePermission("settings.manage");
    const next: PrintSettings = schema.parse(await req.json());

    const problems = checkLayout(PRINT_LAYOUTS[next.layout], next.sizes);
    if (problems.length > 0) {
      return NextResponse.json(
        {
          error: `These sizes don't fit "${PRINT_LAYOUTS[next.layout].label}"`,
          problems: problems.map((p) => p.message),
        },
        { status: 400 }
      );
    }
    const otherId = PRINT_LAYOUT_IDS.find((id) => id !== next.layout)!;
    const warnings = checkLayout(PRINT_LAYOUTS[otherId], next.sizes).map((p) => p.message);

    const before = await getPrintSettings();
    await prisma.setting.upsert({
      where: { key: SETTING_KEYS.printSettings },
      create: { key: SETTING_KEYS.printSettings, value: next as object },
      update: { value: next as object },
    });
    await logAudit({
      userId: session.user.id,
      action: "settings.update",
      entity: "settings",
      entityId: SETTING_KEYS.printSettings,
      before,
      after: next,
    });
    return NextResponse.json({
      settings: next,
      warnings: warnings.length
        ? { layout: PRINT_LAYOUTS[otherId].label, problems: warnings }
        : null,
    });
  } catch (e) {
    return apiError(e);
  }
}
