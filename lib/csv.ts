// CSV helpers for report exports (SPEC §12 — "export CSV").
// Pure + browser-only halves live together but are used only from client
// components, so there is no server import here.

export type CsvCell = string | number | boolean | null | undefined;

// RFC 4180 quoting: wrap in quotes when the value contains a comma, quote,
// or newline, doubling any embedded quotes. A leading UTF-8 BOM makes Excel
// read the file as UTF-8 so Bangla product/category names render correctly.
export function toCsv(headers: string[], rows: CsvCell[][]): string {
  const esc = (v: CsvCell): string => {
    const s = v == null ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers, ...rows].map((r) => r.map(esc).join(","));
  return "\uFEFF" + lines.join("\r\n");
}

// Trigger a browser download of `csv` as `filename` (client-only).
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// YYYY-MM-DD stamp (local) for export filenames.
export function csvDateStamp(): string {
  return new Date().toISOString().slice(0, 10);
}
