import { prisma } from "./prisma.js";
import { PALETTE_COLORS, type PaletteColor } from "../../src/lib/palette.js";
import { notifyCompletion } from "./discord.js";
import { SECTIONS } from "../../src/generated/pookkalam.geometry.js";

// Validate against the generated design — no DB round-trip needed.
const VALID_IDS = new Set(SECTIONS.map((s) => s.id));
const VALID_COLORS = new Set<string>(PALETTE_COLORS);

/** One petal per user per this window — keeps any single person from filling the carpet. */
export const COOLDOWN_MS = 60_000;

/** The party doing the write. `id` is a Profile.id (cuid), same as the web session. */
export interface PaintUser {
  id: string;
  name: string;
  discordId?: string;
}

export type PaintResult =
  | { ok: true; color: PaletteColor; version: number; filledByName: string; justCompleted: boolean }
  | { ok: false; error: string; status: number; retryAfterSec?: number };

/**
 * The single validated paint write, shared by the web `/api/paint` route and the
 * Discord bot. Validates section + colour against the generated design,
 * rate-limits (>15 fills / 10s → 429), then upserts (last-write-wins with a
 * monotonic version bump). Fires the completion announcement on the final petal.
 */
export async function applyPaint(user: PaintUser, sectionId: string, color: string): Promise<PaintResult> {
  if (!VALID_IDS.has(sectionId)) return { ok: false, error: "unknown section", status: 400 };
  if (!VALID_COLORS.has(color)) return { ok: false, error: "bad color", status: 400 };

  try {
    // Per-user cooldown: one petal per COOLDOWN_MS. Uses the last recorded action.
    const prof = await prisma.profile.findUnique({ where: { id: user.id }, select: { lastActionAt: true } });
    if (prof?.lastActionAt) {
      const remaining = COOLDOWN_MS - (Date.now() - prof.lastActionAt.getTime());
      if (remaining > 0) {
        return { ok: false, error: "cooldown", status: 429, retryAfterSec: Math.ceil(remaining / 1000) };
      }
    }

    const cellExists = await prisma.cell.findUnique({ where: { sectionId } });
    const isLastCell = !cellExists && (await prisma.cell.count()) === SECTIONS.length - 1;

    const row = await prisma.cell.upsert({
      where: { sectionId },
      create: { sectionId, color: color as PaletteColor, filledBy: user.id, filledByName: user.name },
      update: {
        color: color as PaletteColor,
        filledBy: user.id,
        filledByName: user.name,
        filledAt: new Date(),
        version: { increment: 1 },
      },
    });

    await prisma.profile
      .update({ where: { id: user.id }, data: { paintCount: { increment: 1 }, lastActionAt: new Date() } })
      .catch(() => undefined);

    if (isLastCell) {
      notifyCompletion().catch((e) => console.error("Discord notify failed:", e));
    }

    return { ok: true, color: row.color, version: row.version, filledByName: row.filledByName, justCompleted: isLastCell };
  } catch {
    return { ok: false, error: "server error", status: 500 };
  }
}

/**
 * Look up (or create) the Profile for a Discord user, returning a PaintUser.
 * Mirrors the OAuth callback so bot and web share the same Profile rows,
 * keyed by Discord id.
 */
export async function resolveProfile(discordId: string, name: string, avatarUrl: string | null): Promise<PaintUser> {
  const p = await prisma.profile.upsert({
    where: { discordId },
    create: { discordId, name, avatarUrl },
    update: { name, avatarUrl },
  });
  return { id: p.id, name, discordId };
}

/** Full painted snapshot as sectionId → colour. */
export async function fetchCells(): Promise<Map<string, PaletteColor>> {
  const rows = await prisma.cell.findMany({ select: { sectionId: true, color: true } });
  return new Map(rows.map((r) => [r.sectionId, r.color as PaletteColor]));
}
