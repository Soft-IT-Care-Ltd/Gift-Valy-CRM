// PHOTO_PRINT.md PP-4 — photos of every shape → exact print files. Uses sharp
// on real images in a temp UPLOAD_DIR (no DB). Run: npm run test:print
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

const dir = mkdtempSync(path.join(tmpdir(), "gv-print-"));
process.env.UPLOAD_DIR = dir;

// UPLOAD_DIR must be set before lib/file-storage reads it — imported below.
import * as photos from "../lib/print-photos";
import { printFilePath } from "../lib/file-storage";
import { DEFAULT_PRINT_SIZES, slotPixels } from "../lib/print-layouts";
const { storeOriginal, makePrintFile, isLowRes, previewName, PhotoError } = photos;

/** Top half red, bottom half blue (in the UPRIGHT picture). */
async function twoTone(w: number, h: number, opts: { exifRotate?: boolean } = {}) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h / 2}" fill="#ff0000"/><rect y="${h / 2}" width="${w}" height="${h / 2}" fill="#0000ff"/></svg>`;
  const upright = sharp(Buffer.from(svg));
  if (!opts.exifRotate) return upright.jpeg().toBuffer();
  // Store it lying on its side (rotated -90°) with EXIF orientation 6 — how a
  // phone writes a portrait photo. A viewer must turn it 90° clockwise.
  const sideways = await upright.rotate(-90).jpeg().toBuffer();
  return sharp(sideways).withMetadata({ orientation: 6 }).jpeg().toBuffer();
}

async function topBottom(buf: Buffer) {
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  const px = (x: number, y: number) => {
    const i = (y * info.width + x) * info.channels;
    return [data[i], data[i + 1], data[i + 2]];
  };
  return { top: px(Math.floor(info.width / 2), 5), bottom: px(Math.floor(info.width / 2), info.height - 6) };
}

after(() => rmSync(dir, { recursive: true, force: true }));

describe("PP-4 print files", () => {
  const cases: [string, number, number][] = [
    ["portrait 1080×1920", 1080, 1920],
    ["landscape 1600×900", 1600, 900],
    ["square 1200×1200", 1200, 1200],
    ["tiny 300×300", 300, 300],
  ];
  for (const [name, w, h] of cases) {
    for (const slot of ["PHOTO_L", "PHOTO_S"] as const) {
      test(`${name} → ${slot} is exactly its pixels, 300 DPI, filled`, async () => {
        const stored = await storeOriginal(await twoTone(w, h));
        assert.deepEqual([stored.srcWidth, stored.srcHeight], [w, h]);
        const out = await makePrintFile(stored, slot, DEFAULT_PRINT_SIZES);
        const meta = await sharp(readFileSync(printFilePath(out.printPath)!)).metadata();
        const px = slotPixels(DEFAULT_PRINT_SIZES[slot]);
        assert.deepEqual([meta.width, meta.height], [px.w, px.h]);
        assert.equal(meta.format, "jpeg");
        assert.equal(meta.density, 300);
        assert.ok(!meta.orientation || meta.orientation === 1, "no EXIF rotation left");
        assert.equal(out.lowRes, w === 300 && slot === "PHOTO_L", "low-res only when the crop is < 150 DPI");
        assert.equal(isLowRes(stored, slot, DEFAULT_PRINT_SIZES), out.lowRes);
      });
    }
  }

  test("a phone photo with EXIF rotation comes out the right way up", async () => {
    const stored = await storeOriginal(await twoTone(900, 1600, { exifRotate: true }));
    assert.deepEqual([stored.srcWidth, stored.srcHeight], [900, 1600], "upright size");
    const out = await makePrintFile({ ...stored, crop: { cx: 0.5, cy: 0.5, zoom: 1 } }, "PHOTO_L", DEFAULT_PRINT_SIZES);
    const { top, bottom } = await topBottom(readFileSync(printFilePath(out.printPath)!));
    assert.ok(top[0] > 200 && top[2] < 60, `top should be red, got ${top}`);
    assert.ok(bottom[2] > 200 && bottom[0] < 60, `bottom should be blue, got ${bottom}`);
    const preview = await topBottom(readFileSync(printFilePath(previewName(stored.originalPath))!));
    assert.ok(preview.top[0] > 200, "preview upright too");
  });

  test("the crop moves the cut: centred low on a tall photo shows the blue half", async () => {
    const stored = await storeOriginal(await twoTone(1000, 3000));
    const out = await makePrintFile({ ...stored, crop: { cx: 0.5, cy: 1, zoom: 1 } }, "PHOTO_L", DEFAULT_PRINT_SIZES);
    const { top, bottom } = await topBottom(readFileSync(printFilePath(out.printPath)!));
    assert.ok(top[2] > 200 && bottom[2] > 200, "all blue");
  });

  test("a changed crop gives a new file name (nothing stale prints)", async () => {
    const stored = await storeOriginal(await twoTone(1200, 1200));
    const a = await makePrintFile(stored, "PHOTO_L", DEFAULT_PRINT_SIZES);
    const b = await makePrintFile({ ...stored, crop: { cx: 0.4, cy: 0.5, zoom: 2 } }, "PHOTO_L", DEFAULT_PRINT_SIZES);
    assert.notEqual(a.printPath, b.printPath);
  });

  test("not an image / unsupported format is refused", async () => {
    await assert.rejects(storeOriginal(Buffer.from("hello")), PhotoError);
    const gif = await sharp({ create: { width: 10, height: 10, channels: 3, background: "#fff" } }).gif().toBuffer();
    await assert.rejects(storeOriginal(gif), PhotoError);
  });
});
