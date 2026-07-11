import type { ReportPdfPayload } from "@/lib/report-pdf";

// Client half of the report PDF export (SPEC §12) — posts the payload built
// from on-screen data to /api/reports/pdf and downloads the result. Lives next
// to lib/csv.ts as the browser-only export helper; the payload TYPE comes from
// lib/report-pdf via `import type` (erased at build, no pdfkit in the bundle).

export async function downloadReportPdf(
  filename: string,
  payload: ReportPdfPayload
): Promise<void> {
  const res = await fetch("/api/reports/pdf", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let msg = `PDF export failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch {
      // non-JSON error body — keep the status message
    }
    throw new Error(msg);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// YYYY-MM-DD stamp (local) for export filenames — same shape as csvDateStamp.
export function pdfDateStamp(): string {
  return new Date().toISOString().slice(0, 10);
}
