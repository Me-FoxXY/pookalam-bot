/**
 * Build-time generator — the SINGLE SOURCE OF TRUTH for the Pookkalam.
 *
 * Recreates a traditional Onam Athapookkalam (see the reference photo) as
 * crisp vector geometry, from the centre out:
 *   pink hub -> spoked chakra -> violet petal flower -> big orange/yellow
 *   lotus petals (white slivers between) -> dense radial marigold "sunburst"
 *   bands separated by maroon rings -> maroon rim -> pink border.
 *
 * Emits:
 *   - src/generated/pookkalam.geometry.ts   (SECTIONS: Section[])
 *   - src/generated/preview.svg             (flat top-down colour preview)
 * The Prisma seed (prisma/seed.ts) reads SECTIONS directly, so ids never drift.
 *
 * Run with:  npm run generate
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { Section } from "../src/lib/types.ts";
import type { PaletteColor } from "../src/lib/palette.ts";
import { PALETTE, codeFor, hexOf, UNPAINTED_HEX } from "../src/lib/palette.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// ------------------------------------------------------------------ //
// Geometry helpers (centre at origin, +y up)
// ------------------------------------------------------------------ //
type Pt = [number, number];
const rad = (deg: number) => (deg * Math.PI) / 180;
const round = (n: number) => Math.round(n * 10) / 10;

function pt(r: number, angleDeg: number): Pt {
  const a = rad(angleDeg);
  return [round(Math.cos(a) * r), round(Math.sin(a) * r)];
}

/** Annular sector polygon between radii r0<r1 and angles a0<a1 (degrees). */
function annularSector(r0: number, r1: number, a0: number, a1: number, steps = 4): Pt[] {
  const poly: Pt[] = [];
  for (let i = 0; i <= steps; i++) poly.push(pt(r1, a0 + ((a1 - a0) * i) / steps));
  for (let i = steps; i >= 0; i--) poly.push(pt(r0, a0 + ((a1 - a0) * i) / steps));
  return poly;
}

/** Lotus-petal (teardrop): rounded near the hub, pointed at the outer tip. */
function petal(r0: number, r1: number, centerDeg: number, halfWidthDeg: number, steps = 10): Pt[] {
  const poly: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const r = r0 + (r1 - r0) * t;
    const w = halfWidthDeg * Math.sin(Math.PI * t) * (1 - t * 0.12);
    poly.push(pt(r, centerDeg - w));
  }
  for (let i = steps; i >= 0; i--) {
    const t = i / steps;
    const r = r0 + (r1 - r0) * t;
    const w = halfWidthDeg * Math.sin(Math.PI * t) * (1 - t * 0.12);
    poly.push(pt(r, centerDeg + w));
  }
  return poly;
}

function centroidOf(poly: Pt[]): Pt {
  let x = 0;
  let y = 0;
  for (const [px, py] of poly) {
    x += px;
    y += py;
  }
  return [round(x / poly.length), round(y / poly.length)];
}

const checker = (i: number, phase: number, a: PaletteColor, b: PaletteColor): PaletteColor =>
  (i + phase) % 2 === 0 ? a : b;

// ------------------------------------------------------------------ //
// Build the sections
// ------------------------------------------------------------------ //
const sections: Section[] = [];

function add(band: string, ring: number, index: number, shape: Pt[], color: PaletteColor) {
  sections.push({
    id: `${band}-${String(index).padStart(2, "0")}`,
    ring,
    band,
    code: codeFor(color, Math.min(7, ring + 1)),
    correctColor: color,
    shape,
    centroid: centroidOf(shape),
  });
}

/** A concentric ring of small tiles (separators + rim/border bands). */
function ringBand(band: string, ring: number, r0: number, r1: number, count: number, color: PaletteColor | ((i: number) => PaletteColor), gapFrac = 0.06) {
  const step = 360 / count;
  for (let i = 0; i < count; i++) {
    const a0 = step * i + step * gapFrac;
    const a1 = step * (i + 1) - step * gapFrac;
    const c = typeof color === "function" ? color(i) : color;
    add(band, ring, i, annularSector(r0, r1, a0, a1, 4), c);
  }
}

// Radii of each concentric zone (design units; overall radius ~500).
const R = {
  hub: 10,
  chakra: 48,
  violet: 116,
  sepA: 130,
  bigPetal: 236,
  sepB: 252,
  burst1: 310,
  burst2: 368,
  sepC: 382,
  burst3: 452,
  rim: 470,
  pink: 500,
};

// --- pink hub dot ---
{
  const poly: Pt[] = [];
  for (let i = 0; i < 20; i++) poly.push(pt(R.hub, (360 / 20) * i));
  add("hub", 0, 0, poly, "pink");
}

// --- spoked chakra (cart-wheel centre): red/yellow spokes ---
{
  const n = 12;
  const step = 360 / n;
  for (let i = 0; i < n; i++) {
    add("chakra", 0, i, annularSector(R.hub, R.chakra, step * i + step * 0.12, step * (i + 1) - step * 0.12, 3), checker(i, 0, "red", "yellow"));
  }
}

// --- violet flower: pointed petals (purple / lavender) ---
{
  const n = 18;
  const step = 360 / n;
  for (let i = 0; i < n; i++) {
    add("violet", 1, i, petal(R.hub + 6, R.violet, step * i + step / 2, step * 0.5, 9), checker(i, 0, "purple", "lavender"));
  }
}

ringBand("sepA", 1, R.violet, R.sepA, 36, "maroon");

// --- big lotus petals (orange/yellow) with white slivers between ---
{
  const n = 16;
  const step = 360 / n;
  for (let i = 0; i < n; i++) {
    add("bigPetal", 2, i, petal(R.sepA - 2, R.bigPetal, step * i, step * 0.4, 12), checker(i, 0, "orange", "yellow"));
    add("whitePetal", 2, i, petal(R.sepA + 30, R.bigPetal - 8, step * i + step / 2, step * 0.1, 9), "white");
  }
}

ringBand("sepB", 2, R.bigPetal, R.sepB, 36, "maroon");

// --- radial marigold "sunburst" bands (aligned rays + concentric checker) ---
{
  const bands = [
    { name: "burst1", ring: 3, r0: R.sepB, r1: R.burst1, count: 36, phase: 0, a: "orange" as PaletteColor, b: "yellow" as PaletteColor },
    { name: "burst2", ring: 4, r0: R.burst1, r1: R.burst2, count: 48, phase: 1, a: "yellow" as PaletteColor, b: "orange" as PaletteColor },
  ];
  for (const bd of bands) {
    const step = 360 / bd.count;
    for (let i = 0; i < bd.count; i++) {
      add(bd.name, bd.ring, i, annularSector(bd.r0, bd.r1, step * i + step * 0.05, step * (i + 1) - step * 0.05, 4), checker(i, bd.phase, bd.a, bd.b));
    }
  }
}

ringBand("sepC", 5, R.burst2, R.sepC, 48, "maroon");

// --- outer sunburst (denser) ---
{
  const count = 48;
  const step = 360 / count;
  for (let i = 0; i < count; i++) {
    add("burst3", 6, i, annularSector(R.sepC, R.burst3, step * i + step * 0.05, step * (i + 1) - step * 0.05, 4), checker(i, 0, "orange", "saffron"));
  }
}

// --- rim: maroon ring + fuzzy pink/magenta border ---
ringBand("rimMaroon", 7, R.burst3, R.rim, 48, "maroon");
ringBand("pink", 7, R.rim, R.pink, 60, "pink", 0.03);

// ------------------------------------------------------------------ //
// Emit TypeScript geometry
// ------------------------------------------------------------------ //
const designRadius = R.pink;
function serializeSections(list: Section[]): string {
  const lines = list.map((s) => {
    const shape = s.shape.map(([x, y]) => `[${x},${y}]`).join(",");
    return (
      `  { id: ${JSON.stringify(s.id)}, ring: ${s.ring}, band: ${JSON.stringify(s.band)}, ` +
      `code: ${JSON.stringify(s.code)}, correctColor: ${JSON.stringify(s.correctColor)}, ` +
      `centroid: [${s.centroid[0]},${s.centroid[1]}], shape: [${shape}] }`
    );
  });
  return `[\n${lines.join(",\n")}\n]`;
}

const geomHeader = `// AUTO-GENERATED by scripts/generate-pookkalam.ts — do not edit by hand.
// Run \`npm run generate\` to rebuild.
import type { Section } from "../lib/types";

export const DESIGN_RADIUS = ${designRadius};
export const SECTION_COUNT = ${sections.length};

export const SECTIONS: Section[] = ${serializeSections(sections)};
`;

const geomDir = resolve(ROOT, "src/generated");
mkdirSync(geomDir, { recursive: true });
writeFileSync(resolve(geomDir, "pookkalam.geometry.ts"), geomHeader, "utf8");

// ------------------------------------------------------------------ //
// Emit a flat top-down SVG preview (left = coloured, right = un-painted)
// ------------------------------------------------------------------ //
const pad = 24;
const size = designRadius + pad;
const polyPoints = (shape: Pt[]) => shape.map(([x, y]) => `${x},${-y}`).join(" ");
function panel(colored: boolean): string {
  const cells = sections
    .map((s) => {
      const fill = colored ? hexOf(s.correctColor) : UNPAINTED_HEX;
      return `<polygon points="${polyPoints(s.shape)}" fill="${fill}" stroke="#0b0c15" stroke-width="1.1" stroke-linejoin="round"/>`;
    })
    .join("\n");
  return `<g><circle cx="0" cy="0" r="${designRadius + 12}" fill="#0e1018"/>${cells}</g>`;
}
const w = size * 4 + pad;
const h = size * 2;
const previewSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="1200" style="background:#0b0c15">
  <g transform="translate(${size},${size})">${panel(true)}</g>
  <g transform="translate(${size * 3 + pad},${size})">${panel(false)}</g>
</svg>`;
writeFileSync(resolve(geomDir, "preview.svg"), previewSvg, "utf8");

// A single coloured disc for the hero banner.
const heroSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-size} ${-size} ${size * 2} ${size * 2}" width="900">${panel(true)}</svg>`;
writeFileSync(resolve(geomDir, "hero.svg"), heroSvg, "utf8");

// ------------------------------------------------------------------ //
// Report
// ------------------------------------------------------------------ //
const byColor: Record<string, number> = {};
for (const s of sections) byColor[s.correctColor] = (byColor[s.correctColor] ?? 0) + 1;
console.log(`Generated ${sections.length} sections (design radius ${designRadius}).`);
for (const c of Object.keys(PALETTE) as PaletteColor[]) {
  if (byColor[c]) console.log(`  ${c.padEnd(10)} ${byColor[c]}`);
}
console.log("Wrote src/generated/pookkalam.geometry.ts and preview.svg");
