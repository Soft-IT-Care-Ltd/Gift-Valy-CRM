import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthzError, apiError, requireUser } from "@/lib/authz";
import { getEffectivePermissions } from "@/lib/rbac";
import { getPrintSettings } from "@/lib/settings";
import { PRINT_LIBRARY_READ, designForRender } from "@/lib/card-library";
import { renderCard, normalizeTextBox } from "@/lib/print-card";
import { cardLines, CARD_TEXT_MAX } from "@/lib/print-card-text";
import { uploadUrlPath, printFontPath } from "@/lib/file-storage";

// PHOTO_PRINT.md PP-3 — renders a card exactly as it will print (same
// renderer as the PDF), from the design fields sent — so the design form can
// preview unsaved edits. Returns a PNG with the fitted size in headers:
// X-Card-Font-Pt and X-Card-Fits ("0" = text too long even at the minimum).
const schema = z.object({
  slot: z.enum(["CARD_1", "CARD_2"]),
  design: z.object({
    backgroundPath: z.string().nullable(),
    textBox: z.unknown(),
    textColor: z.string(),
    align: z.enum(["LEFT", "CENTER", "RIGHT"]),
    fontPath: z.string().nullable(),
    maxFontPt: z.number().min(5).max(48),
    minFontPt: z.number().min(5).max(48),
  }),
  text: z.string().max(CARD_TEXT_MAX),
  to: z.string().max(60).optional(),
  from: z.string().max(60).optional(),
  /** Preview width in px (the card is rendered at 300 DPI, then scaled). */
  width: z.number().int().min(100).max(1600).optional(),
});

export async function POST(req: Request) {
  try {
    const session = await requireUser();
    const permissions = await getEffectivePermissions(session.user.id);
    if (!PRINT_LIBRARY_READ.some((k) => permissions.includes(k))) {
      throw new AuthzError(403, "Missing permission: print.edit");
    }
    const body = schema.parse(await req.json());
    // Only files this app wrote may be referenced.
    if (body.design.backgroundPath && !uploadUrlPath(body.design.backgroundPath)) {
      return NextResponse.json({ error: "Unknown background" }, { status: 400 });
    }
    if (body.design.fontPath && !printFontPath(body.design.fontPath)) {
      return NextResponse.json({ error: "Unknown font" }, { status: 400 });
    }
    const { sizes } = await getPrintSettings();
    const design = designForRender({
      ...body.design,
      textBox: normalizeTextBox(body.design.textBox),
      minFontPt: Math.min(body.design.minFontPt, body.design.maxFontPt),
    });
    const card = await renderCard(
      design,
      sizes[body.slot],
      cardLines(body.text, { to: body.to, from: body.from })
    );
    let png = card.png;
    if (body.width && body.width < card.width) {
      const { default: sharp } = await import("sharp");
      png = await sharp(png).resize({ width: body.width }).png().toBuffer();
    }
    return new NextResponse(new Uint8Array(png), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "private, no-store",
        "X-Card-Font-Pt": String(card.fontPt),
        "X-Card-Fits": card.fits ? "1" : "0",
      },
    });
  } catch (e) {
    return apiError(e);
  }
}
