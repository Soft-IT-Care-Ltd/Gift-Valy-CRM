import { z } from "zod";
import { webBagLines } from "@/lib/storefront/catalog";
import { BAG_BODY_LIMIT, BodyTooLargeError, publicJson, readJsonLimited, rejectCrossSite, rejectNonJson } from "@/lib/storefront/http";

// ROUND3 W-5 — the bag and the checkout, re-read: each line saved in the
// visitor's browser as it is now (name, photo, today's price for its picks,
// stock as a word, delivery charge per zone) through the catalog gate.
// Read-only, same-site, never cached.
export const dynamic = "force-dynamic";

const schema = z
  .object({
    lines: z
      .array(
        z
          .object({
            kind: z.enum(["product", "package"]),
            slug: z.string().max(80),
            picks: z.record(z.string().regex(/^\d{1,9}$/), z.number().int().positive()),
          })
          .strict()
      )
      .max(30),
  })
  .strict();

export async function POST(request: Request) {
  const refused = rejectCrossSite(request) ?? rejectNonJson(request);
  if (refused) return refused;
  let body: unknown;
  try {
    body = await readJsonLimited(request, BAG_BODY_LIMIT);
  } catch (error) {
    if (error instanceof BodyTooLargeError) return publicJson({ error: "Too large" }, 413);
    throw error;
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return publicJson({ error: "Invalid bag" }, 400);
  return publicJson({ lines: await webBagLines(parsed.data.lines) });
}
