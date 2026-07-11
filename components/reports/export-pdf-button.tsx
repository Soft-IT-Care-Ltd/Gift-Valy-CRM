"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { downloadReportPdf } from "@/lib/pdf-client";
import type { ReportPdfPayload } from "@/lib/report-pdf";

// Shared "Export PDF" button for every report page (SPEC §12). The payload is
// built lazily on click from the data the page is already showing, so the PDF
// always matches the current filters and the caller's role scope.
export function ExportPdfButton({
  filename,
  build,
  size = "sm",
}: {
  filename: string;
  build: () => ReportPdfPayload;
  size?: "sm" | "default";
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function onClick() {
    setBusy(true);
    setError(false);
    try {
      await downloadReportPdf(filename, build());
    } catch (e) {
      console.error(e);
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant="outline" size={size} onClick={onClick} disabled={busy}>
      {busy ? "Exporting…" : error ? "Failed — retry" : "Export PDF"}
    </Button>
  );
}
