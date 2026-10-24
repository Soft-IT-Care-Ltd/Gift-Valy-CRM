// PHOTO_PRINT.md PP-4 — photo uploads from the browser.
//
// prepareImage: a JPEG/PNG/WebP of ≤ 10 MB goes up untouched; anything larger,
// or a format the server doesn't read (an iPhone's HEIC — Safari can decode
// it), is redrawn to a JPEG of at most 4000 px on the long side (the browser
// applies the EXIF rotation when it decodes). 4000 px is still ~4× what a big
// photo needs at 300 DPI, keeps each request under Nginx's 12 MB, and saves
// mobile data.
//
// uploadWithProgress: XMLHttpRequest, because fetch has no upload progress.

const PASS_TYPES = ["image/jpeg", "image/png", "image/webp"];
const PASS_MAX_BYTES = 10 * 1024 * 1024;
const MAX_EDGE = 4000;

export class UploadError extends Error {}

async function decode(file: Blob): Promise<CanvasImageSource & { width: number; height: number }> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      // fall through to <img> (older Safari)
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return Object.assign(img, { width: img.naturalWidth, height: img.naturalHeight });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function prepareImage(file: File): Promise<Blob> {
  if (PASS_TYPES.includes(file.type) && file.size <= PASS_MAX_BYTES) return file;
  let src;
  try {
    src = await decode(file);
  } catch {
    throw new UploadError("এই ছবিটা খোলা যাচ্ছে না / This photo can't be opened — send it as JPEG");
  }
  const scale = Math.min(1, MAX_EDGE / Math.max(src.width, src.height));
  const w = Math.max(1, Math.round(src.width * scale));
  const h = Math.max(1, Math.round(src.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(src, 0, 0, w, h);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.92));
  if (!blob) throw new UploadError("এই ছবিটা খোলা যাচ্ছে না / This photo can't be opened");
  return blob;
}

/** POSTs multipart form data; resolves with the JSON body, rejects with the
 *  server's error message. */
export function uploadWithProgress<T>(
  url: string,
  form: FormData,
  onProgress: (fraction: number) => void
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response as T);
      else
        reject(
          new UploadError(
            (xhr.response as { error?: string } | null)?.error ??
              (xhr.status === 413 ? "Photo too large" : `Upload failed (${xhr.status})`)
          )
        );
    };
    xhr.onerror = () => reject(new UploadError("নেটওয়ার্ক সমস্যা / Network error — tap Retry"));
    xhr.send(form);
  });
}

/** Runs `tasks` with at most `limit` at a time. */
export async function runLimited(tasks: (() => Promise<void>)[], limit = 3): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++;
      await tasks[i]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
}
