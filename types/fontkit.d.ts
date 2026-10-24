// The slice of fontkit (no bundled types) the card-font upload uses
// (PHOTO_PRINT PP-3): read a font's names and check it covers Bangla.
declare module "fontkit" {
  export interface Font {
    familyName: string;
    subfamilyName: string;
    fullName: string;
    hasGlyphForCodePoint(codePoint: number): boolean;
  }
  export function create(buffer: Buffer): Font | { fonts: Font[] };
  export function openSync(path: string): Font | { fonts: Font[] };
}
