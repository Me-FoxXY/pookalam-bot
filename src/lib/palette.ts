/**
 * The fixed traditional-flower palette, transcribed from the reference
 * "Atham Pookalam Color Key & Required Flowers" chart.
 *
 * These keys ARE the Postgres `palette_color` enum values — keep the two in
 * sync (see supabase/migrations/0001_init.sql). This file is imported by both
 * the build-time generator and the React app, so colours never drift.
 */
export const PALETTE = {
  maroon: { hex: "#7B1E2B", flower: "Deep Maroon Rose", label: "Maroon", letter: "A" },
  orange: { hex: "#F5821F", flower: "Orange Marigold", label: "Orange", letter: "B" },
  saffron: { hex: "#EF6C1A", flower: "Deep Orange Marigold", label: "Saffron", letter: "C" },
  purple: { hex: "#8E5AC8", flower: "Purple Aster", label: "Purple", letter: "D" },
  lavender: { hex: "#C9A0DC", flower: "Lavender", label: "Lavender", letter: "E" },
  white: { hex: "#FBFAF5", flower: "White Jasmine", label: "White", letter: "F" },
  pink: { hex: "#D6006E", flower: "Pink Bougainvillea", label: "Pink", letter: "G" },
  green: { hex: "#2E9E44", flower: "Green Leaf", label: "Green", letter: "H" },
  yellow: { hex: "#F6C324", flower: "Yellow Marigold", label: "Yellow", letter: "Y" },
  red: { hex: "#C1272D", flower: "Red Rose", label: "Red", letter: "R" },
} as const;

export type PaletteColor = keyof typeof PALETTE;

/** Stable display order for the palette picker (warm → cool → neutral). */
export const PALETTE_ORDER: PaletteColor[] = [
  "maroon",
  "red",
  "orange",
  "saffron",
  "yellow",
  "pink",
  "purple",
  "lavender",
  "green",
  "white",
];

export const PALETTE_COLORS = Object.keys(PALETTE) as PaletteColor[];

export function hexOf(color: PaletteColor): string {
  return PALETTE[color].hex;
}

export function flowerOf(color: PaletteColor): string {
  return PALETTE[color].flower;
}

export function labelOf(color: PaletteColor): string {
  return PALETTE[color].label;
}

/** Neutral tone for an un-painted tile (the "outline" state of the chart). */
export const UNPAINTED_HEX = "#20242f";
export const UNPAINTED_EDGE_HEX = "#3a4152";

/** Base the ghost/preview tints blend toward (matches the 3D ground). */
const GHOST_BASE = "#15171f";

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}
function mixHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return rgbToHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}

/**
 * Faint, dark tint of a section's correct colour — shown BEFORE it is painted
 * so the whole design (and where each colour goes) reads as a colour-by-number
 * guide. Painting then "lights it up" to the vivid colour.
 */
export function ghostHexOf(color: PaletteColor): string {
  return mixHex(hexOf(color), GHOST_BASE, 0.76);
}

/** Stronger preview of the target colour, used by the "show finished" toggle. */
export function previewHexOf(color: PaletteColor): string {
  return mixHex(hexOf(color), GHOST_BASE, 0.28);
}

/**
 * Build the short cell code shown on hover (e.g. "A1", "D3"), echoing the
 * reference chart's colour-key style: family letter from the colour + a shade
 * index derived from the ring so inner/outer rings read differently.
 */
export function codeFor(color: PaletteColor, shadeIndex: number): string {
  return `${PALETTE[color].letter}${shadeIndex}`;
}
