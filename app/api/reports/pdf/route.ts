import { z } from "zod";
import { requireUser, apiError } from "@/lib/authz";
import { renderReportPdf } from "@/lib/report-pdf";

// SPEC §12 — "export CSV + PDF" for every report. The client posts the exact
// table data it is already displaying (built server-side under the caller's
// role scope), and gets back a printable A4 PDF. The renderer adds no data of
// its own, so this endpoint cannot leak anything the caller couldn't see —
// it only needs an authenticated user, not a per-report permission.

const cell = z.union([z.string().max(500), z.number(), z.null()]);

const sectionSchema = z.object({
  heading: z.string().max(200).optional(),
  note: z.string().max(600).optional(),
  headers: z.array(z.string().max(120)).min(1).max(24),
  aligns: z.array(z.enum(["l", "r"])).max(24).optional(),
  rows: z.array(z.array(cell).max(24)).max(5000),
});

const payloadSchema = z.object({
  title: z.string().min(1).max(150),
  subtitle: z.string().max(500).optional(),
  landscape: z.boolean().optional(),
  kpis: z
    .array(z.object({ label: z.string().max(80), value: z.string().max(80) }))
    .max(12)
    .optional(),
  sections: z.array(sectionSchema).min(1).max(16),
});

export async function POST(req: Request) {
  try {
    const session = await requireUser();
    const payload = payloadSchema.parse(await req.json());

    const pdf = await renderReportPdf(payload, {
      generatedBy: session.user.name ?? session.user.email ?? "—",
    });

    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="report.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return apiError(e);
  }
}
