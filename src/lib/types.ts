import type { PaletteColor } from "./palette";

/** One colourable region of the Pookkalam. Emitted by the generator. */
export interface Section {
  /** Stable id, e.g. "petalOuter-07". Identical in geometry + DB seed. */
  id: string;
  /** Concentric ring index, 0 = centre. */
  ring: number;
  /** Named band this section belongs to (center, rosette, petalInner, brickA, rim2, …). */
  band: string;
  /** Short hint code shown on hover, e.g. "B3". */
  code: string;
  /** The hinted "correct" flower colour for guided colour-by-number. */
  correctColor: PaletteColor;
  /** Closed polygon outline in 2D design units (centre at origin). */
  shape: [number, number][];
  /** Centroid in design units — animation origin + label anchor. */
  centroid: [number, number];
}

/** Live painted state of a single section (mirrors a `cells` row). */
export interface CellState {
  color: PaletteColor;
  /** Monotonic version — the single source of truth for reconciliation. */
  version: number;
  filledByName: string | null;
  /** True while an optimistic local write awaits server confirmation. */
  pending?: boolean;
}
