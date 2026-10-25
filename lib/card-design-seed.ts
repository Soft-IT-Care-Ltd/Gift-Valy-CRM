// PHOTO_PRINT.md PP-3 — the starter card designs `npm run db:seed-card-designs`
// adds: six backgrounds drawn as SVG (so they are sharp at 300 DPI on any card
// size), each for Card 1 and Card 2. The text box keeps the middle of the card
// clear of decoration; the colour is the design's text colour.
//
// Every background is drawn on a 1000 × 1000 canvas and stretched to the
// card's exact pixels — both cards are almost square (126.3 × 126.5 mm,
// 99.2 × 99.5 mm), so nothing visibly distorts.

import type { CardTextBox } from "./print-card";

export interface SeedCardDesign {
  name: string;
  /** Which occasions it suits (shown in the name). */
  textBox: CardTextBox;
  textColor: string;
  maxFontPt: number;
  minFontPt: number;
  /** The SVG body (inside a 1000 × 1000 viewBox). */
  svg: () => string;
}

// ---------- small drawing helpers ----------

/** Deterministic pseudo-random numbers — the same design on every run. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const f = (n: number) => n.toFixed(1);

/** A flower: `n` round petals around a centre. */
function flower(cx: number, cy: number, r: number, petal: string, centre: string, n = 6, turn = 0) {
  const petals = Array.from({ length: n }, (_, i) => {
    const a = turn + (i * 360) / n;
    return `<ellipse cx="${f(cx)}" cy="${f(cy - r * 0.55)}" rx="${f(r * 0.42)}" ry="${f(r * 0.6)}" fill="${petal}" transform="rotate(${f(a)} ${f(cx)} ${f(cy)})"/>`;
  }).join("");
  return `<g>${petals}<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r * 0.28)}" fill="${centre}"/></g>`;
}

/** A rose seen from above: rings of overlapping petals, darker inside. */
function rose(cx: number, cy: number, r: number, light: string, mid: string, dark: string) {
  const rings: [number, number, string, number][] = [
    [1, 7, light, 0],
    [0.72, 6, mid, 20],
    [0.46, 5, dark, 40],
  ];
  const body = rings
    .map(([k, n, colour, turn]) =>
      Array.from({ length: n }, (_, i) => {
        const a = turn + (i * 360) / n;
        return `<ellipse cx="${f(cx)}" cy="${f(cy - r * k * 0.45)}" rx="${f(r * k * 0.5)}" ry="${f(r * k * 0.55)}" fill="${colour}" stroke="#ffffff" stroke-opacity="0.35" stroke-width="2" transform="rotate(${f(a)} ${f(cx)} ${f(cy)})"/>`;
      }).join("")
    )
    .join("");
  return `<g>${body}<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r * 0.16)}" fill="${dark}"/></g>`;
}

/** A pointed leaf from (x, y), `len` long, pointing at `angle` degrees. */
function leaf(x: number, y: number, len: number, angle: number, fill: string, vein = "#ffffff") {
  const w = len * 0.32;
  return `<g transform="translate(${f(x)} ${f(y)}) rotate(${f(angle)})">
    <path d="M0 0 C ${f(w)} ${f(-len * 0.3)}, ${f(w)} ${f(-len * 0.75)}, 0 ${f(-len)} C ${f(-w)} ${f(-len * 0.75)}, ${f(-w)} ${f(-len * 0.3)}, 0 0 Z" fill="${fill}"/>
    <path d="M0 0 L0 ${f(-len * 0.92)}" stroke="${vein}" stroke-opacity="0.45" stroke-width="2.5" fill="none"/>
  </g>`;
}

/** A heart centred on (cx, cy), `s` wide. */
function heart(cx: number, cy: number, s: number, fill: string, angle = 0, opacity = 1) {
  const k = s / 100;
  return `<path transform="translate(${f(cx)} ${f(cy)}) rotate(${f(angle)}) scale(${k.toFixed(3)})" fill="${fill}" fill-opacity="${opacity}"
    d="M0 35 C -10 25, -50 5, -50 -20 C -50 -45, -20 -55, 0 -30 C 20 -55, 50 -45, 50 -20 C 50 5, 10 25, 0 35 Z"/>`;
}

/** A five-point star. */
function star(cx: number, cy: number, r: number, fill: string, opacity = 1) {
  const pts = Array.from({ length: 10 }, (_, i) => {
    const rad = i % 2 === 0 ? r : r * 0.45;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    return `${f(cx + rad * Math.cos(a))},${f(cy + rad * Math.sin(a))}`;
  }).join(" ");
  return `<polygon points="${pts}" fill="${fill}" fill-opacity="${opacity}"/>`;
}

/** A four-point sparkle. */
function sparkle(cx: number, cy: number, r: number, fill: string, opacity = 1) {
  return `<path transform="translate(${f(cx)} ${f(cy)})" fill="${fill}" fill-opacity="${opacity}"
    d="M0 ${f(-r)} Q ${f(r * 0.18)} ${f(-r * 0.18)} ${f(r)} 0 Q ${f(r * 0.18)} ${f(r * 0.18)} 0 ${f(r)} Q ${f(-r * 0.18)} ${f(r * 0.18)} ${f(-r)} 0 Q ${f(-r * 0.18)} ${f(-r * 0.18)} 0 ${f(-r)} Z"/>`;
}

/** The same group in all four corners (mirrored), drawn for the top-left. */
function corners(g: string) {
  return [
    `<g>${g}</g>`,
    `<g transform="translate(1000 0) scale(-1 1)">${g}</g>`,
    `<g transform="translate(0 1000) scale(1 -1)">${g}</g>`,
    `<g transform="translate(1000 1000) scale(-1 -1)">${g}</g>`,
  ].join("");
}

// ---------- the designs ----------

/** 1 · Blush roses — birthday, love, mother. */
function blushRoses() {
  const cluster = [
    leaf(150, 120, 120, 120, "#86a873"),
    leaf(120, 160, 110, 200, "#9cbf86"),
    leaf(250, 70, 100, 95, "#9cbf86"),
    leaf(80, 260, 100, 175, "#86a873"),
    rose(115, 105, 95, "#f9c9d4", "#f19bb0", "#e06f8e"),
    rose(245, 80, 60, "#fbd7df", "#f5adbf", "#e98aa3"),
    rose(75, 240, 58, "#fbd7df", "#f5adbf", "#e98aa3"),
    flower(320, 45, 22, "#fde4ea", "#f4a9bb", 5),
    flower(45, 330, 20, "#fde4ea", "#f4a9bb", 5, 20),
    `<circle cx="355" cy="95" r="7" fill="#e98aa3"/><circle cx="95" cy="365" r="6" fill="#e98aa3"/><circle cx="300" cy="140" r="5" fill="#f19bb0"/>`,
  ].join("");
  return `
    <defs><radialGradient id="bg" cx="50%" cy="50%" r="70%">
      <stop offset="0" stop-color="#fffafb"/><stop offset="1" stop-color="#fde8ee"/>
    </radialGradient></defs>
    <rect width="1000" height="1000" fill="url(#bg)"/>
    <rect x="38" y="38" width="924" height="924" rx="28" fill="none" stroke="#f0b7c6" stroke-width="5"/>
    <rect x="54" y="54" width="892" height="892" rx="20" fill="none" stroke="#f0b7c6" stroke-width="1.5" stroke-dasharray="2 10" stroke-linecap="round"/>
    ${corners(cluster)}`;
}

/** 2 · Golden elegance — anniversary, wedding, congratulations. */
function goldenElegance() {
  const gold = "#b8892c";
  const flourish = `
    <path d="M70 230 C 70 140, 140 70, 230 70" fill="none" stroke="${gold}" stroke-width="5"/>
    <path d="M95 300 C 95 180, 180 95, 300 95" fill="none" stroke="${gold}" stroke-width="2"/>
    <path d="M70 230 C 110 210, 140 180, 150 150 C 180 140, 210 110, 230 70" fill="none" stroke="${gold}" stroke-width="2"/>
    <circle cx="150" cy="150" r="12" fill="${gold}"/>
    <circle cx="150" cy="150" r="22" fill="none" stroke="${gold}" stroke-width="2"/>
    ${leaf(150, 150, 70, -45, "#d4af5a", "#fff8e6")}
    ${leaf(150, 150, 55, -10, "#e2c47e", "#fff8e6")}
    ${leaf(150, 150, 55, -80, "#e2c47e", "#fff8e6")}
    <circle cx="300" cy="95" r="6" fill="${gold}"/><circle cx="95" cy="300" r="6" fill="${gold}"/>`;
  return `
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fffdf7"/><stop offset="1" stop-color="#f7efdc"/></linearGradient>
      <linearGradient id="gl" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d9b45b"/><stop offset="0.5" stop-color="#f3dc9a"/><stop offset="1" stop-color="#b8892c"/></linearGradient>
    </defs>
    <rect width="1000" height="1000" fill="url(#bg)"/>
    <rect x="30" y="30" width="940" height="940" fill="none" stroke="url(#gl)" stroke-width="10"/>
    <rect x="52" y="52" width="896" height="896" fill="none" stroke="${gold}" stroke-width="2"/>
    ${corners(flourish)}
    <g transform="translate(500 132)">
      <path d="M-160 0 L-40 0" stroke="${gold}" stroke-width="2"/><path d="M40 0 L160 0" stroke="${gold}" stroke-width="2"/>
      ${heart(0, 0, 44, "#c99a3c")}
    </g>
    <g transform="translate(500 868)">
      <path d="M-160 0 L-40 0" stroke="${gold}" stroke-width="2"/><path d="M40 0 L160 0" stroke="${gold}" stroke-width="2"/>
      ${sparkle(0, 0, 22, "#c99a3c")}
    </g>`;
}

/** 3 · Balloons & confetti — birthday, congratulations. */
function balloonsConfetti() {
  const r = rng(7);
  const colours = ["#f87171", "#fbbf24", "#34d399", "#60a5fa", "#a78bfa", "#f472b6"];
  const confetti: string[] = [];
  for (let i = 0; i < 90; i++) {
    // Only the outer band — the middle stays clear for the text.
    let x = r() * 1000;
    let y = r() * 1000;
    if (x > 150 && x < 850 && y > 200 && y < 850) {
      if (r() < 0.5) x = x < 500 ? x * 0.15 : 1000 - (1000 - x) * 0.15;
      else y = y < 500 ? y * 0.2 : 1000 - (1000 - y) * 0.15;
    }
    const c = colours[i % colours.length];
    const kind = i % 3;
    confetti.push(
      kind === 0
        ? `<circle cx="${f(x)}" cy="${f(y)}" r="${f(5 + r() * 6)}" fill="${c}" fill-opacity="0.85"/>`
        : kind === 1
          ? `<rect x="${f(x)}" y="${f(y)}" width="${f(8 + r() * 8)}" height="${f(16 + r() * 10)}" rx="3" fill="${c}" fill-opacity="0.85" transform="rotate(${f(r() * 180)} ${f(x)} ${f(y)})"/>`
          : `<path d="M${f(x)} ${f(y)} q 10 -12 20 0 t 20 0" stroke="${c}" stroke-width="5" fill="none" stroke-linecap="round" transform="rotate(${f(r() * 180)} ${f(x)} ${f(y)})"/>`
    );
  }
  const balloon = (x: number, y: number, s: number, c: string, shine: string) => `
    <path d="M${f(x)} ${f(y + s * 1.18)} C ${f(x - 20)} ${f(y + s * 1.6)}, ${f(x + 25)} ${f(y + s * 1.9)}, ${f(x - 5)} ${f(y + s * 2.4)}" stroke="#9ca3af" stroke-width="3" fill="none"/>
    <ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(s * 0.85)}" ry="${f(s)}" fill="${c}"/>
    <path d="M${f(x - 10)} ${f(y + s * 0.98)} L${f(x + 10)} ${f(y + s * 0.98)} L${f(x)} ${f(y + s * 1.18)} Z" fill="${c}"/>
    <ellipse cx="${f(x - s * 0.3)}" cy="${f(y - s * 0.4)}" rx="${f(s * 0.16)}" ry="${f(s * 0.28)}" fill="${shine}" fill-opacity="0.6" transform="rotate(-25 ${f(x - s * 0.3)} ${f(y - s * 0.4)})"/>`;
  return `
    <rect width="1000" height="1000" fill="#fffdf8"/>
    <rect x="30" y="30" width="940" height="940" rx="36" fill="none" stroke="#fcd9a8" stroke-width="6" stroke-dasharray="26 14" stroke-linecap="round"/>
    ${confetti.join("")}
    ${balloon(130, 140, 70, "#f87171", "#ffffff")}
    ${balloon(225, 95, 55, "#60a5fa", "#ffffff")}
    ${balloon(870, 140, 70, "#a78bfa", "#ffffff")}
    ${balloon(775, 95, 55, "#fbbf24", "#ffffff")}
    <g transform="translate(500 905)">
      ${star(-60, 0, 16, "#fbbf24")}${star(0, -6, 22, "#f472b6")}${star(60, 0, 16, "#34d399")}
    </g>`;
}

/** 4 · Eid crescent — Eid, Ramadan, prayers. */
function eidCrescent() {
  const gold = "#c9a227";
  const lantern = (x: number, len: number, s: number) => `
    <g transform="translate(${x} 0)">
      <line x1="0" y1="0" x2="0" y2="${len}" stroke="${gold}" stroke-width="3"/>
      <g transform="translate(0 ${len})">
        <path d="M${-s * 0.35} 0 L${s * 0.35} 0 L${s * 0.2} ${-s * 0.25} L${-s * 0.2} ${-s * 0.25} Z" fill="${gold}"/>
        <path d="M${-s * 0.5} 0 Q 0 ${-s * 0.1} ${s * 0.5} 0 L${s * 0.42} ${s * 1.1} Q 0 ${s * 1.25} ${-s * 0.42} ${s * 1.1} Z" fill="#0f5132" stroke="${gold}" stroke-width="4"/>
        <path d="M0 ${s * 0.12} L0 ${s * 1.12}" stroke="${gold}" stroke-width="2"/>
        <ellipse cx="0" cy="${s * 0.62}" rx="${s * 0.2}" ry="${s * 0.3}" fill="#fde68a" fill-opacity="0.9"/>
        <path d="M${-s * 0.25} ${s * 1.16} L${s * 0.25} ${s * 1.16} L0 ${s * 1.42} Z" fill="${gold}"/>
      </g>
    </g>`;
  const r = rng(11);
  const stars = Array.from({ length: 22 }, (_, i) => {
    const x = 60 + r() * 880;
    const y = i % 2 ? 40 + r() * 140 : 850 + r() * 110;
    return sparkle(x, y, 6 + r() * 9, "#f3d77a", 0.9);
  }).join("");
  return `
    <defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0b3d2e"/><stop offset="1" stop-color="#145c43"/>
    </linearGradient></defs>
    <rect width="1000" height="1000" fill="url(#bg)"/>
    ${stars}
    <rect x="70" y="190" width="860" height="640" rx="40" fill="#fffbef"/>
    <rect x="86" y="206" width="828" height="608" rx="30" fill="none" stroke="${gold}" stroke-width="3"/>
    ${lantern(130, 40, 70)}${lantern(870, 40, 70)}${lantern(250, 20, 46)}${lantern(750, 20, 46)}
    <g transform="translate(500 110)">
      <circle cx="0" cy="0" r="52" fill="${gold}"/>
      <circle cx="20" cy="-10" r="46" fill="#0d4634"/>
      ${star(52, -26, 14, "#f3d77a")}
    </g>
    <g transform="translate(500 905)">
      <path d="M-120 0 L-30 0 M30 0 L120 0" stroke="${gold}" stroke-width="3"/>
      ${star(0, 0, 18, gold)}
    </g>`;
}

/** 5 · Sweet hearts — love, anniversary, missing you. */
function sweetHearts() {
  const r = rng(23);
  const reds = ["#e11d48", "#f43f5e", "#fb7185", "#fda4af", "#be123c"];
  const hearts: string[] = [];
  for (let i = 0; i < 70; i++) {
    const side = i % 4;
    const t = r();
    const d = r() * 150;
    const [x, y] =
      side === 0 ? [t * 1000, 30 + d] : side === 1 ? [t * 1000, 970 - d] : side === 2 ? [30 + d, t * 1000] : [970 - d, t * 1000];
    hearts.push(heart(x, y, 24 + r() * 46, reds[i % reds.length], -30 + r() * 60, 0.55 + r() * 0.45));
  }
  return `
    <defs><radialGradient id="bg" cx="50%" cy="50%" r="70%">
      <stop offset="0" stop-color="#fffafa"/><stop offset="1" stop-color="#ffe4e9"/>
    </radialGradient></defs>
    <rect width="1000" height="1000" fill="url(#bg)"/>
    ${hearts.join("")}
    <rect x="180" y="200" width="640" height="600" rx="60" fill="#ffffff" fill-opacity="0.82"/>
    <rect x="196" y="216" width="608" height="568" rx="48" fill="none" stroke="#fb7185" stroke-width="2.5" stroke-dasharray="3 12" stroke-linecap="round"/>`;
}

/** 6 · Mint leaves — thank you, sorry, congratulations, any day. */
function mintLeaves() {
  const sprig = (x: number, y: number, angle: number, scale: number) => {
    const ls = [0, 1, 2, 3, 4]
      .map((i) => leaf(0, -i * 60, 85 - i * 8, i % 2 ? 50 : -50, i % 2 ? "#6ea98a" : "#8cc2a4", "#f0fbf5"))
      .join("");
    return `<g transform="translate(${x} ${y}) rotate(${angle}) scale(${scale})">
      <path d="M0 0 C 10 -100, -10 -200, 0 -290" stroke="#5b8f74" stroke-width="5" fill="none"/>${ls}
      ${leaf(0, -280, 70, 0, "#8cc2a4", "#f0fbf5")}</g>`;
  };
  const branch = [
    sprig(70, 330, 30, 1),
    sprig(120, 380, 60, 0.75),
    flower(210, 120, 24, "#ffffff", "#f6c453", 5),
    flower(260, 175, 17, "#ffffff", "#f6c453", 5, 30),
    `<circle cx="300" cy="110" r="8" fill="#b9dcc8"/><circle cx="330" cy="150" r="5" fill="#b9dcc8"/>`,
  ].join("");
  return `
    <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#f6fcf8"/><stop offset="1" stop-color="#e3f3ea"/>
    </linearGradient></defs>
    <rect width="1000" height="1000" fill="url(#bg)"/>
    <rect x="40" y="40" width="920" height="920" rx="24" fill="none" stroke="#9ccbb0" stroke-width="4"/>
    <g>${branch}</g>
    <g transform="translate(1000 1000) scale(-1 -1)">${branch}</g>
    <g transform="translate(860 120)">${flower(0, 0, 22, "#ffffff", "#f6c453", 5)}${flower(45, 40, 15, "#ffffff", "#f6c453", 5, 30)}</g>
    <g transform="translate(140 880)">${flower(0, 0, 22, "#ffffff", "#f6c453", 5)}${flower(-30, -40, 15, "#ffffff", "#f6c453", 5, 30)}</g>`;
}

export const SEED_CARD_DESIGNS: SeedCardDesign[] = [
  { name: "Blush roses — Birthday / Love / Mother", textBox: { x: 19, y: 25, w: 62, h: 50 }, textColor: "#9d174d", maxFontPt: 16, minFontPt: 9, svg: blushRoses },
  { name: "Golden elegance — Anniversary / Wedding", textBox: { x: 15, y: 19, w: 70, h: 61 }, textColor: "#7a5514", maxFontPt: 16, minFontPt: 9, svg: goldenElegance },
  { name: "Balloons & confetti — Birthday", textBox: { x: 17, y: 30, w: 66, h: 50 }, textColor: "#1e3a8a", maxFontPt: 16, minFontPt: 9, svg: balloonsConfetti },
  { name: "Eid crescent — Eid / Ramadan", textBox: { x: 13, y: 26, w: 74, h: 50 }, textColor: "#0b3d2e", maxFontPt: 16, minFontPt: 9, svg: eidCrescent },
  { name: "Sweet hearts — Love / Missing you", textBox: { x: 22, y: 25, w: 56, h: 50 }, textColor: "#9f1239", maxFontPt: 16, minFontPt: 9, svg: sweetHearts },
  { name: "Mint leaves — Thank you / Any day", textBox: { x: 18, y: 22, w: 64, h: 56 }, textColor: "#14532d", maxFontPt: 16, minFontPt: 9, svg: mintLeaves },
];

/** The full SVG at exact pixels (the 1000 × 1000 drawing stretched). */
export function cardDesignSvg(design: SeedCardDesign, w: number, h: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 1000 1000" preserveAspectRatio="none">${design.svg()}</svg>`;
}
