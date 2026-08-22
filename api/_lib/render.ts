import { Resvg } from "@resvg/resvg-js";
import { SECTIONS, DESIGN_RADIUS } from "../../src/generated/pookkalam.geometry.js";
import { hexOf, ghostHexOf, type PaletteColor } from "../../src/lib/palette.js";

const BY_ID = new Map(SECTIONS.map((s) => [s.id, s]));

// SVG is y-down; design space is y-up, so flip y.
function polyPoints(shape: [number, number][]): string {
  return shape.map(([x, y]) => `${x},${-y}`).join(" ");
}

// ------------------------------------------------------------------ //
// Font-free 7-segment digits — so labels render without system fonts.
// ------------------------------------------------------------------ //
const SEGMENTS: Record<string, string[]> = {
  "0": ["a", "b", "c", "d", "e", "f"],
  "1": ["b", "c"],
  "2": ["a", "b", "g", "e", "d"],
  "3": ["a", "b", "g", "c", "d"],
  "4": ["f", "g", "b", "c"],
  "5": ["a", "f", "g", "c", "d"],
  "6": ["a", "f", "g", "e", "c", "d"],
  "7": ["a", "b", "c"],
  "8": ["a", "b", "c", "d", "e", "f", "g"],
  "9": ["a", "b", "c", "d", "f", "g"],
};

function digitSvg(cx: number, cy: number, ch: string, h: number, color: string): string {
  const segs = SEGMENTS[ch];
  if (!segs) return "";
  const w = h * 0.62;
  const sw = Math.max(2, h * 0.16);
  const top = cy - h / 2;
  const mid = cy;
  const bot = cy + h / 2;
  const left = cx - w / 2;
  const right = cx + w / 2;
  const line = (x1: number, y1: number, x2: number, y2: number) =>
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${sw}" stroke-linecap="round"/>`;
  const coords: Record<string, [number, number, number, number]> = {
    a: [left, top, right, top],
    b: [right, top, right, mid],
    c: [right, mid, right, bot],
    d: [left, bot, right, bot],
    e: [left, mid, left, bot],
    f: [left, top, left, mid],
    g: [left, mid, right, mid],
  };
  return segs.map((s) => line(...coords[s])).join("");
}

/** Draw a number centred at (cx, cy) using 7-segment digits. */
function numberSvg(cx: number, cy: number, value: number, h: number, color: string): string {
  const str = String(value);
  const w = h * 0.62;
  const gap = h * 0.28;
  const totalW = str.length * w + (str.length - 1) * gap;
  let x = cx - totalW / 2 + w / 2;
  const out: string[] = [];
  for (const ch of str) {
    out.push(digitSvg(x, cy, ch, h, color));
    x += w + gap;
  }
  return out.join("");
}

export interface RenderOpts {
  /** Section ids to outline in gold (the tile(s) in focus). */
  highlight?: string[];
  /** Sections to stamp with a number badge (paint picker). */
  numbered?: { id: string; n: number }[];
}

/** Build a flat top-down SVG of the current carpet. */
export function renderSVG(cells: Map<string, PaletteColor>, opts: RenderOpts = {}): string {
  const pad = 24;
  const size = DESIGN_RADIUS + pad;
  const highlight = new Set(opts.highlight ?? []);

  const tiles = SECTIONS.map((s) => {
    const painted = cells.get(s.id);
    const fill = painted ? hexOf(painted) : ghostHexOf(s.correctColor);
    const hi = highlight.has(s.id);
    const stroke = hi ? "#FFF3C4" : "#0b0c15";
    const sw = hi ? 7 : 1.1;
    return `<polygon points="${polyPoints(s.shape)}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"/>`;
  }).join("");

  const badges = (opts.numbered ?? [])
    .map(({ id, n }) => {
      const s = BY_ID.get(id);
      if (!s) return "";
      const [cx, cy] = s.centroid;
      const y = -cy;
      const r = 20;
      return (
        `<circle cx="${cx}" cy="${y}" r="${r}" fill="#0b0c15" fill-opacity="0.82" stroke="#FFF3C4" stroke-width="2.5"/>` +
        numberSvg(cx, y, n, 20, "#FFF3C4")
      );
    })
    .join("");

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-size} ${-size} ${size * 2} ${size * 2}">` +
    `<circle cx="0" cy="0" r="${DESIGN_RADIUS + 12}" fill="#0e1018"/>` +
    tiles +
    badges +
    `</svg>`
  );
}

/** Rasterise an SVG string to a PNG buffer (no fonts required). */
export function toPng(svg: string, width = 720): Buffer {
  const r = new Resvg(svg, { background: "#0b0c15", fitTo: { mode: "width", value: width } });
  return Buffer.from(r.render().asPng());
}

/** Convenience: render the carpet straight to PNG. */
export function renderPng(cells: Map<string, PaletteColor>, opts: RenderOpts = {}, width = 720): Buffer {
  return toPng(renderSVG(cells, opts), width);
}
