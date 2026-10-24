import path from "node:path";
import { mkdir, readdir, rename, unlink, writeFile } from "node:fs/promises";

// FUNNEL_LINER.md GV-11 — where uploads and invoice PDFs live on disk.
//
// On the server every deploy is a new release folder (scripts/deploy.sh), so
// both folders sit OUTSIDE it: UPLOAD_DIR=/srv/giftvaly/uploads and
// INVOICE_DIR=/srv/giftvaly/invoices (staging: /srv/giftvaly-staging/…).
// Development defaults to ./storage/uploads and ./storage/invoices (the
// gitignored /storage folder).
//
// Neither may be inside public/: Next serves public/ files itself, before any
// route runs and without a session, so an upload there downloads with no
// login. Uploads are served only by app/uploads/[...path]/route.ts (signed in),
// invoice PDFs only by /api/orders/[id]/invoice. Nginx never serves either.
//
// Only this file turns a stored URL / pdfUrl into a path on disk.

/** Refuses a folder inside public/ — Next would serve it without a login. */
export function assertPrivateDir(setting: string, dir: string, cwd = /* turbopackIgnore: true */ process.cwd()): string {
  const publicDir = path.resolve(/* turbopackIgnore: true */ cwd, "public");
  if (dir === publicDir || dir.startsWith(publicDir + path.sep)) {
    throw new Error(`${setting} (${dir}) is inside public/, which Next serves without a login (FUNNEL_LINER.md GV-11).`);
  }
  return dir;
}

function resolveDir(setting: "UPLOAD_DIR" | "INVOICE_DIR", fallback: string): string {
  const cwd = /* turbopackIgnore: true */ process.cwd();
  const dir = path.resolve(/* turbopackIgnore: true */ cwd, process.env[setting] || fallback);
  return assertPrivateDir(setting, dir, cwd);
}

/** Uploaded images: catalog photos, payment screenshots, receipts, the invoice logo. */
export function uploadRoot(): string {
  return resolveDir("UPLOAD_DIR", "./storage/uploads");
}

/** Generated invoice PDFs (customer PII). */
export function invoiceRoot(): string {
  return resolveDir("INVOICE_DIR", "./storage/invoices");
}

// ── Uploads ────────────────────────────────────────────────────────────────
// Every upload is one flat file named by the server (<uuid>.<ext> or
// invoice-logo-<uuid>.<ext>) and stored in the database as /uploads/<name>.

const UPLOAD_NAME = /^[A-Za-z0-9][A-Za-z0-9-]{0,127}\.(jpg|jpeg|png|webp)$/;

export const UPLOAD_CONTENT_TYPE: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/** The file on disk for an upload's name, or null when the name isn't one we write. */
export function uploadPath(name: string): string | null {
  if (!UPLOAD_NAME.test(name)) return null;
  return path.join(/* turbopackIgnore: true */ uploadRoot(), name);
}

/** The file on disk for a stored "/uploads/<name>" URL, or null. */
export function uploadUrlPath(url: string | null | undefined): string | null {
  const m = /^\/uploads\/([^/]+)$/.exec(url ?? "");
  return m ? uploadPath(m[1]) : null;
}

/** Writes a new upload and returns the URL to store ("/uploads/<name>"). */
export async function saveUpload(name: string, data: Buffer): Promise<string> {
  const file = uploadPath(name);
  if (!file) throw new Error(`Invalid upload name: ${name}`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, data);
  return `/uploads/${name}`;
}

// ── Gift print files (PHOTO_PRINT PP-4) ───────────────────────────────────
// Customer photos and rendered cards: UPLOAD_DIR/print/<name>, flat, named by
// the server. Originals are "<uuid>.<ext>", their screen preview
// "<uuid>-preview.jpg", the 300 DPI print file "<uuid>-print-<rev>.jpg" and a
// rendered card "card-<uuid>.png". Served only by app/uploads/[...path] →
// /uploads/print/<name>, which checks the row's order scope and the print
// permissions — never the plain signed-in check of other uploads.

const PRINT_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9-]{0,127}\.(jpg|jpeg|png|webp)$/;

/** The file on disk for a print file name, or null when the name isn't one we write. */
export function printFilePath(name: string | null | undefined): string | null {
  if (!name || !PRINT_FILE_NAME.test(name)) return null;
  return path.join(/* turbopackIgnore: true */ uploadRoot(), "print", name);
}

/** Writes a print file and returns its name (what the rows store). */
export async function savePrintFile(name: string, data: Buffer): Promise<string> {
  const file = printFilePath(name);
  if (!file) throw new Error(`Invalid print file name: ${name}`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, data);
  return name;
}

/** Removes print files; missing files are fine (already cleaned). */
export async function deletePrintFiles(names: (string | null | undefined)[]): Promise<void> {
  for (const name of names) {
    const file = printFilePath(name);
    if (!file) continue;
    try {
      await unlink(file);
    } catch {
      // already gone
    }
  }
}

// ── Card fonts (PHOTO_PRINT PP-3) ─────────────────────────────────────────
// An Admin may upload another font for a card design. Fonts are only read by
// the server's card renderer — never served — and live in UPLOAD_DIR/fonts as
// <uuid>.ttf|otf; card_designs.font_path holds the bare file name.

const FONT_NAME = /^[A-Za-z0-9][A-Za-z0-9-]{0,127}\.(ttf|otf)$/;

/** The file on disk for a card font name, or null when the name isn't one we write. */
export function printFontPath(name: string | null | undefined): string | null {
  if (!name || !FONT_NAME.test(name)) return null;
  return path.join(/* turbopackIgnore: true */ uploadRoot(), "fonts", name);
}

/** Every uploaded card font's file name (none yet → []). */
export async function listPrintFonts(): Promise<string[]> {
  try {
    const names = await readdir(path.join(/* turbopackIgnore: true */ uploadRoot(), "fonts"));
    return names.filter((n) => FONT_NAME.test(n)).sort();
  } catch {
    return [];
  }
}

/** Writes an uploaded card font and returns the name to store. */
export async function savePrintFont(name: string, data: Buffer): Promise<string> {
  const file = printFontPath(name);
  if (!file) throw new Error(`Invalid font name: ${name}`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, data);
  return name;
}

// ── Invoice PDFs ───────────────────────────────────────────────────────────
// invoices.pdfUrl holds the file name (GV-2611-0001-v1.pdf). Rows written
// before GV-11 hold "storage/invoices/<file>"; only the file name is used, so
// both find the file in INVOICE_DIR.

const PDF_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.pdf$/;

/** The file on disk for an invoices.pdfUrl value (old or new form). */
export function invoicePdfPath(pdfUrl: string): string {
  const name = pdfUrl.split("/").pop() ?? "";
  if (!PDF_NAME.test(name) || name.includes("..")) throw new Error(`Invalid invoice file: ${pdfUrl}`);
  return path.join(/* turbopackIgnore: true */ invoiceRoot(), name);
}

/** Writes an invoice PDF and returns the value to store in invoices.pdfUrl. */
export async function saveInvoicePdf(fileName: string, pdf: Buffer): Promise<string> {
  const file = invoicePdfPath(fileName);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, pdf);
  return fileName;
}

// ── Gift print PDFs (PHOTO_PRINT PP-6) ────────────────────────────────────
// One cached PDF per order and content hash: INVOICE_DIR/print/<orderNo>-<hash>.pdf.
// The name IS the content hash, so a stale PDF is never served; older ones of
// the same order are removed when a new one is written. Served only by
// /api/orders/[id]/print-pdf (print.print).

const PRINT_PDF_NAME = /^[A-Za-z0-9-]{1,64}-[0-9a-f]{12}\.pdf$/;

function printPdfDir(): string {
  return path.join(/* turbopackIgnore: true */ invoiceRoot(), "print");
}

/** "GV-2610-0001" → a safe file-name stem. */
function printPdfStem(orderNo: string): string {
  return orderNo.replace(/[^A-Za-z0-9-]/g, "-").slice(0, 64) || "order";
}

export function printPdfPath(orderNo: string, hash12: string): string {
  const name = `${printPdfStem(orderNo)}-${hash12}.pdf`;
  if (!PRINT_PDF_NAME.test(name)) throw new Error(`Invalid print PDF name: ${name}`);
  return path.join(printPdfDir(), name);
}

/** Writes the PDF (tmp + rename, so a reader never sees half a file) and
 *  removes the order's older print PDFs. */
export async function savePrintPdf(orderNo: string, hash12: string, pdf: Buffer): Promise<string> {
  const file = printPdfPath(orderNo, hash12);
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, pdf);
  await rename(tmp, file);
  await deletePrintPdfs(orderNo, path.basename(file));
  return file;
}

/** Deletes an order's cached print PDFs (all, or all but `keep`). */
export async function deletePrintPdfs(orderNo: string, keep?: string): Promise<void> {
  const prefix = `${printPdfStem(orderNo)}-`;
  let names: string[];
  try {
    names = await readdir(printPdfDir());
  } catch {
    return;
  }
  for (const n of names) {
    if (n === keep || !n.startsWith(prefix) || !PRINT_PDF_NAME.test(n)) continue;
    // "<stem>-<hash>.pdf" only — GV-2610-0001 must not catch GV-2610-00011.
    if (n.length !== prefix.length + 16) continue;
    try {
      await unlink(path.join(printPdfDir(), n));
    } catch {
      // already gone
    }
  }
}
