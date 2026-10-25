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

// ---------- cartoon couples (the owner's sample: a boy + a girl, cute flat style) ----------

const SKIN = "#ffe1c7";
const INK = "#3b2a20";

interface Person {
  girl: boolean;
  hair: string;
  top: string;
  bottom: string;
  /** Head tilt toward the partner, degrees. */
  tilt?: number;
  /** The arm on the partner's side. */
  pose: "offer" | "hand" | "hug";
  /** The far arm raised (holding a balloon string). */
  raiseBack?: boolean;
  kiss?: boolean;
}

/**
 * One chibi person, ~210 units tall, feet at (0, 0), facing +x (the partner
 * stands on the right; mirror with scale(-1 1) for the one on the right).
 */
function person(p: Person): string {
  const legs = p.girl
    ? `<rect x="-14" y="-40" width="10" height="38" rx="5" fill="${SKIN}"/><rect x="4" y="-40" width="10" height="38" rx="5" fill="${SKIN}"/>`
    : `<rect x="-17" y="-50" width="14" height="48" rx="7" fill="${p.bottom}"/><rect x="3" y="-50" width="14" height="48" rx="7" fill="${p.bottom}"/>`;
  const shoes = `<ellipse cx="-11" cy="-3" rx="12" ry="6" fill="#5b3a29"/><ellipse cx="11" cy="-3" rx="12" ry="6" fill="#5b3a29"/>`;
  const body = p.girl
    ? `<path d="M-24 -112 Q0 -122 24 -112 L46 -36 Q0 -24 -46 -36 Z" fill="${p.top}"/>
       <path d="M-46 -36 Q0 -24 46 -36 L44 -42 Q0 -31 -44 -42 Z" fill="${p.bottom}"/>`
    : `<path d="M-30 -112 Q0 -124 30 -112 L34 -48 Q0 -40 -34 -48 Z" fill="${p.top}"/>
       <path d="M-12 -116 L0 -104 L12 -116" fill="none" stroke="#ffffff" stroke-opacity="0.6" stroke-width="3"/>`;
  const arm = (x1: number, y1: number, x2: number, y2: number) =>
    `<path d="M${x1} ${y1} L${x2} ${y2}" stroke="${p.top}" stroke-width="15" stroke-linecap="round"/><circle cx="${x2}" cy="${y2 + 2}" r="8" fill="${SKIN}"/>`;
  const backArm = p.raiseBack ? arm(-24, -104, -50, -150) : arm(-24, -104, -36, -62);
  const front =
    p.pose === "offer"
      ? arm(24, -104, 60, -96) +
        `<path d="M62 -94 C 64 -110, 70 -122, 70 -136" stroke="#3f8f4f" stroke-width="4" fill="none"/>` +
        leaf(66, -112, 18, 60, "#4caf63") +
        rose(70, -146, 15, "#ff8a9a", "#f2546b", "#c81d3c")
      : p.pose === "hug"
        ? arm(24, -104, 74, -94)
        : arm(24, -104, 46, -66);

  // The head, tilted about the neck toward the partner.
  const backHair = p.girl
    ? `<circle cx="0" cy="-152" r="46" fill="${p.hair}"/><rect x="-46" y="-152" width="92" height="56" rx="20" fill="${p.hair}"/>
       <circle cx="-20" cy="-198" r="17" fill="${p.hair}"/>`
    : "";
  const frontHair = p.girl
    ? `<path d="M-41 -150 Q-42 -198 0 -198 Q42 -198 41 -150 Q36 -178 12 -180 Q-6 -168 -41 -150 Z" fill="${p.hair}"/>
       ${heart(28, -184, 16, "#ff5c7a")}`
    : `<path d="M-41 -150 Q-44 -200 0 -200 Q44 -200 41 -150 Q34 -172 18 -172 Q8 -162 -2 -176 Q-16 -164 -28 -172 Q-36 -162 -41 -150 Z" fill="${p.hair}"/>`;
  const mouth = p.kiss
    ? `<ellipse cx="33" cy="-137" rx="4.5" ry="4" fill="#e8455e"/>`
    : `<path d="M0 -137 q6 6 12 0" stroke="#b4535f" stroke-width="3" fill="none" stroke-linecap="round"/>`;
  const head = `<g transform="rotate(${p.tilt ?? 0} 0 -112)">
    ${backHair}
    <rect x="-7" y="-120" width="14" height="12" fill="${SKIN}"/>
    <circle cx="-38" cy="-148" r="7" fill="${SKIN}"/><circle cx="38" cy="-148" r="7" fill="${SKIN}"/>
    <circle cx="0" cy="-152" r="38" fill="${SKIN}"/>
    <path d="M-16 -150 q6 -7 12 0 M8 -150 q6 -7 12 0" stroke="${INK}" stroke-width="3.5" fill="none" stroke-linecap="round"/>
    ${p.girl ? `<path d="M-17 -152 l-4 -3 M21 -152 l4 -3" stroke="${INK}" stroke-width="2.5" stroke-linecap="round"/>` : ""}
    <ellipse cx="-20" cy="-139" rx="7.5" ry="4.5" fill="#ff8fa3" fill-opacity="0.65"/>
    <ellipse cx="25" cy="-139" rx="7.5" ry="4.5" fill="#ff8fa3" fill-opacity="0.65"/>
    ${mouth}
    ${frontHair}
  </g>`;
  return `<g>${backArm}${legs}${shoes}${body}${front}${head}</g>`;
}

/** The two of them: `a` on the left facing right, `b` mirrored on the right. */
function couple(cx: number, feetY: number, gap: number, s: number, a: Person, b: Person) {
  return `<g transform="translate(${cx - gap} ${feetY}) scale(${s})">${person(a)}</g>
    <g transform="translate(${cx + gap} ${feetY}) scale(${-s} ${s})">${person(b)}</g>`;
}

/** Hearts scattered over the card, but never inside `keep` (the text box, in 0–1000 units). */
function scatterHearts(seed: number, n: number, colours: string[], min: number, max: number, keep: { x: number; y: number; w: number; h: number }) {
  const r = rng(seed);
  const out: string[] = [];
  let tries = 0;
  while (out.length < n && tries++ < n * 20) {
    const x = r() * 1000;
    const y = r() * 1000;
    const s = min + r() * (max - min);
    if (x + s / 2 > keep.x && x - s / 2 < keep.x + keep.w && y + s / 2 > keep.y && y - s / 2 < keep.y + keep.h) continue;
    out.push(heart(x, y, s, colours[out.length % colours.length], -25 + r() * 50, 0.55 + r() * 0.45));
  }
  return out.join("");
}

/** A row of grass blades along the bottom edge. */
function grass(colour: string, height = 40, seed = 3) {
  const r = rng(seed);
  let d = "M0 1000";
  for (let x = 0; x <= 1000; x += 18) d += ` L${f(x + 9)} ${f(1000 - height * (0.5 + r() * 0.8))} L${f(x + 18)} 1000`;
  return `<path d="${d} Z" fill="${colour}"/>`;
}

/** A tree whose crown is a cloud of hearts. */
function heartTree(x: number, y: number, R: number, seed: number, colours: string[], trunk: string, lean: number) {
  const r = rng(seed);
  const hearts = Array.from({ length: 34 }, (_, i) => {
    const a = r() * Math.PI * 2;
    const d = Math.sqrt(r()) * R;
    return heart(x + Math.cos(a) * d, y + Math.sin(a) * d * 0.9, 34 + r() * 40, colours[i % colours.length], -30 + r() * 60, 0.75 + r() * 0.25);
  }).join("");
  return `<path d="M${x - 18 + lean} 1000 C ${x - 10 + lean} ${f(y + R * 0.9)}, ${x + 10} ${f(y + R * 0.6)}, ${x} ${y}
    L${x + 14} ${y} C ${x + 26} ${f(y + R * 0.6)}, ${x + 12 + lean} ${f(y + R * 0.9)}, ${x + 22 + lean} 1000 Z" fill="${trunk}"/>${hearts}`;
}

/** 7 · A rose for you — the boy gives her a flower. */
function roseForYou() {
  const keep = { x: 150, y: 40, w: 700, h: 500 };
  return `
    <defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff3f8"/><stop offset="0.6" stop-color="#fbd3e4"/><stop offset="1" stop-color="#f6b3cf"/>
    </linearGradient></defs>
    <rect width="1000" height="1000" fill="url(#bg)"/>
    <ellipse cx="120" cy="20" rx="220" ry="110" fill="#ffffff" fill-opacity="0.7"/>
    <ellipse cx="900" cy="10" rx="200" ry="90" fill="#ffffff" fill-opacity="0.6"/>
    ${scatterHearts(31, 34, ["#ff7b8f", "#f9a8c0", "#e2558a", "#ffb3a7"], 26, 70, keep)}
    <ellipse cx="500" cy="985" rx="420" ry="45" fill="#f29cbf" fill-opacity="0.6"/>
    ${couple(500, 975, 122, 1.85,
      { girl: false, hair: "#6b3a26", top: "#ef6f53", bottom: "#3d405b", tilt: 6, pose: "offer" },
      { girl: true, hair: "#8b4a2b", top: "#f7d9cb", bottom: "#e9b8a4", tilt: 8, pose: "hand" })}
    ${sparkle(500, 600, 16, "#ffffff", 0.9)}${sparkle(380, 640, 10, "#ffffff", 0.8)}${sparkle(640, 630, 12, "#ffffff", 0.8)}`;
}

/** 8 · Sweet kiss — inside a heart wreath, with heart trees on both sides. */
function sweetKiss() {
  const wreath = Array.from({ length: 40 }, (_, i) => {
    const a = (i / 40) * Math.PI * 2;
    // A heart-shaped ring: r(θ) of the classic heart curve, scaled.
    const t = a;
    const hx = 16 * Math.sin(t) ** 3;
    const hy = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
    const x = 500 + hx * 15;
    const y = 690 + hy * 15;
    return i % 2 ? leaf(x, y, 46, (a * 180) / Math.PI, "#e0607e") : heart(x, y, 52, i % 4 ? "#ff4d6d" : "#ff8fa3");
  }).join("");
  return `
    <defs><radialGradient id="bg" cx="50%" cy="45%" r="65%">
      <stop offset="0" stop-color="#ffffff"/><stop offset="0.7" stop-color="#ffe3ee"/><stop offset="1" stop-color="#f7b6d0"/>
    </radialGradient></defs>
    <rect width="1000" height="1000" fill="url(#bg)"/>
    ${heartTree(45, 360, 125, 41, ["#e94f8b", "#f48fb1", "#c2185b", "#f8bbd0"], "#c06a8a", -20)}
    ${heartTree(955, 360, 125, 43, ["#e94f8b", "#f48fb1", "#c2185b", "#f8bbd0"], "#c06a8a", 20)}
    ${heart(330, 70, 50, "#e57fb0", -15, 0.8)}${heart(740, 60, 60, "#e57fb0", 15, 0.8)}${heart(840, 160, 34, "#f48fb1", 10, 0.8)}
    ${wreath}
    ${grass("#f3a6c6", 46, 5)}${grass("#e98ab3", 30, 9)}
    ${couple(500, 985, 78, 1.6,
      { girl: false, hair: "#8c1c13", top: "#e63946", bottom: "#c1121f", tilt: 16, pose: "hand", kiss: true },
      { girl: true, hair: "#b5302a", top: "#e63946", bottom: "#c1121f", tilt: 16, pose: "hand", kiss: true })}
    ${heart(500, 640, 44, "#ff1f4b")}
    ${sparkle(440, 700, 9, "#ffffff")}${sparkle(560, 690, 9, "#ffffff")}`;
}

/** 9 · Together forever — holding hands, a heart balloon. */
function togetherForever() {
  const keep = { x: 150, y: 40, w: 700, h: 400 };
  const [CX, FEET, GAP, S] = [540, 975, 100, 1.75];
  // The boy's raised hand (person(): hand at (-50, -150)) holds the string.
  const hand = { x: CX - GAP - 50 * S, y: FEET - 148 * S };
  const r = rng(55);
  const dots = Array.from({ length: 26 }, () => {
    const x = r() * 1000;
    const y = 460 + r() * 380;
    return `<circle cx="${f(x)}" cy="${f(y)}" r="${f(3 + r() * 6)}" fill="#ffffff" fill-opacity="0.7"/>`;
  }).join("");
  return `
    <defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fbf5ff"/><stop offset="0.55" stop-color="#eadcff"/><stop offset="1" stop-color="#f9c7de"/>
    </linearGradient></defs>
    <rect width="1000" height="1000" fill="url(#bg)"/>
    ${scatterHearts(57, 16, ["#c084fc", "#f472b6", "#a78bfa"], 22, 46, keep)}
    ${dots}
    <path d="M${f(hand.x)} ${f(hand.y)} C ${f(hand.x - 20)} ${f(hand.y - 70)}, 250 590, 245 540" stroke="#9ca3af" stroke-width="3" fill="none"/>
    ${heart(240, 500, 120, "#ef4060")}
    <ellipse cx="208" cy="478" rx="12" ry="20" fill="#ffffff" fill-opacity="0.55" transform="rotate(-30 208 478)"/>
    <path d="M0 1000 Q250 900 500 940 T1000 900 L1000 1000 Z" fill="#f3a6c6" fill-opacity="0.7"/>
    ${couple(CX, FEET, GAP, S,
      { girl: false, hair: "#3b2416", top: "#4f7cac", bottom: "#2b3a55", tilt: 5, pose: "hand", raiseBack: true },
      { girl: true, hair: "#5a2d1b", top: "#f28482", bottom: "#e5676a", tilt: 7, pose: "hand" })}
    ${sparkle(800, 560, 14, "#ffffff")}${sparkle(860, 650, 9, "#ffffff")}`;
}

/** 10 · Under the moon — a hug beneath a night sky (light text). */
function underTheMoon() {
  const r = rng(77);
  const stars = Array.from({ length: 70 }, () => {
    const x = r() * 1000;
    const y = r() * 700;
    return r() < 0.25 ? sparkle(x, y, 6 + r() * 8, "#fff3c4", 0.9) : `<circle cx="${f(x)}" cy="${f(y)}" r="${f(1.5 + r() * 2.5)}" fill="#ffffff" fill-opacity="${f(0.5 + r() * 0.5)}"/>`;
  }).join("");
  return `
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b1f4b"/><stop offset="0.6" stop-color="#4b2c6f"/><stop offset="1" stop-color="#b24d8a"/></linearGradient>
      <radialGradient id="glow" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#fff6d5" stop-opacity="0.55"/><stop offset="1" stop-color="#fff6d5" stop-opacity="0"/></radialGradient>
    </defs>
    <rect width="1000" height="1000" fill="url(#bg)"/>
    ${stars}
    <circle cx="500" cy="700" r="230" fill="url(#glow)"/>
    <circle cx="500" cy="700" r="150" fill="#fff4cf"/>
    <circle cx="455" cy="660" r="20" fill="#f3e3b0"/><circle cx="545" cy="740" r="28" fill="#f3e3b0"/><circle cx="560" cy="650" r="12" fill="#f3e3b0"/>
    <path d="M0 1000 L0 900 Q150 850 300 890 Q420 920 500 890 Q620 850 760 885 Q880 915 1000 870 L1000 1000 Z" fill="#2a1840"/>
    ${couple(500, 985, 68, 1.6,
      { girl: false, hair: "#24140e", top: "#3a86ff", bottom: "#1d3557", tilt: 10, pose: "hug" },
      { girl: true, hair: "#3d1e14", top: "#ff70a6", bottom: "#d94f86", tilt: 12, pose: "hug" })}
    ${heart(500, 560, 46, "#ff4d6d")}${heart(450, 520, 24, "#ff8fa3", -15)}${heart(552, 515, 20, "#ff8fa3", 15)}`;
}

export const SEED_CARD_DESIGNS: SeedCardDesign[] = [
  { name: "Blush roses — Birthday / Love / Mother", textBox: { x: 19, y: 25, w: 62, h: 50 }, textColor: "#9d174d", maxFontPt: 16, minFontPt: 9, svg: blushRoses },
  { name: "Golden elegance — Anniversary / Wedding", textBox: { x: 15, y: 19, w: 70, h: 61 }, textColor: "#7a5514", maxFontPt: 16, minFontPt: 9, svg: goldenElegance },
  { name: "Balloons & confetti — Birthday", textBox: { x: 17, y: 30, w: 66, h: 50 }, textColor: "#1e3a8a", maxFontPt: 16, minFontPt: 9, svg: balloonsConfetti },
  { name: "Eid crescent — Eid / Ramadan", textBox: { x: 13, y: 26, w: 74, h: 50 }, textColor: "#0b3d2e", maxFontPt: 16, minFontPt: 9, svg: eidCrescent },
  { name: "Sweet hearts — Love / Missing you", textBox: { x: 22, y: 25, w: 56, h: 50 }, textColor: "#9f1239", maxFontPt: 16, minFontPt: 9, svg: sweetHearts },
  { name: "Mint leaves — Thank you / Any day", textBox: { x: 18, y: 22, w: 64, h: 56 }, textColor: "#14532d", maxFontPt: 16, minFontPt: 9, svg: mintLeaves },
  // Cartoon couples: the message at the top, the picture in the bottom half.
  { name: "Cartoon couple: a rose for you — Love / Anniversary", textBox: { x: 15, y: 5, w: 70, h: 50 }, textColor: "#c8102e", maxFontPt: 15, minFontPt: 8, svg: roseForYou },
  { name: "Cartoon couple: sweet kiss — Anniversary / Love", textBox: { x: 21, y: 5, w: 58, h: 42 }, textColor: "#c8102e", maxFontPt: 15, minFontPt: 8, svg: sweetKiss },
  { name: "Cartoon couple: together forever — Anniversary", textBox: { x: 16, y: 5, w: 68, h: 39 }, textColor: "#7e22ce", maxFontPt: 15, minFontPt: 8, svg: togetherForever },
  { name: "Cartoon couple: under the moon — Love / Missing you", textBox: { x: 15, y: 5, w: 70, h: 44 }, textColor: "#fff6e5", maxFontPt: 15, minFontPt: 8, svg: underTheMoon },
];

/** The full SVG at exact pixels (the 1000 × 1000 drawing stretched). */
export function cardDesignSvg(design: SeedCardDesign, w: number, h: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 1000 1000" preserveAspectRatio="none">${design.svg()}</svg>`;
}
