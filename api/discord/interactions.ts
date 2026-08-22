import { waitUntil } from "@vercel/functions";
import type { Req, Res } from "../_lib/http.js";
import {
  CallbackType,
  ComponentType,
  ButtonStyle,
  MessageFlags,
  InteractionType,
  REGIONS,
  regionByKey,
  editOriginal,
  extractUser,
  verifyDiscordSignature,
  type EditPayload,
} from "../_lib/interactions.js";
import { applyPaint, resolveProfile, fetchCells, type PaintUser } from "../_lib/paint-core.js";
import { renderPng } from "../_lib/render.js";
import { SECTIONS } from "../../src/generated/pookkalam.geometry.js";
import { PALETTE_ORDER, labelOf, flowerOf, type PaletteColor } from "../../src/lib/palette.js";

const APP_ID = process.env.DISCORD_APPLICATION_ID ?? "";
const PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY ?? "";
const ONAM_GOLD = 0xd97706;
const TOTAL = SECTIONS.length;
const BY_ID = new Map(SECTIONS.map((s) => [s.id, s]));
const IMG = "attachment://pookalam.png";

// ------------------------------------------------------------------ //
// Tiny raw-body + response plumbing.
// ------------------------------------------------------------------ //
function readRaw(req: Req): Promise<Buffer> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", () => resolve(Buffer.concat(chunks)));
  });
}

function reply(res: Res, payload: unknown): void {
  res.statusCode = 200;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(payload));
}

/** Ack now (deferred), then finish the slow work (render + edit) in the background. */
function defer(res: Res, ephemeral: boolean, work: () => Promise<void>): void {
  reply(res, { type: CallbackType.DEFERRED_CHANNEL_MESSAGE, data: ephemeral ? { flags: MessageFlags.EPHEMERAL } : {} });
  runBackground(work);
}
function deferUpdate(res: Res, work: () => Promise<void>): void {
  reply(res, { type: CallbackType.DEFERRED_UPDATE_MESSAGE });
  runBackground(work);
}
function runBackground(work: () => Promise<void>): void {
  const p = work().catch((e) => console.error("interaction bg error:", e));
  try {
    waitUntil(p);
  } catch {
    /* non-Vercel env: the awaited process stays alive on its own */
  }
}

// ------------------------------------------------------------------ //
// Shared UI builders.
// ------------------------------------------------------------------ //
function progress(cells: Map<string, PaletteColor>) {
  const filled = cells.size;
  return { filled, pct: Math.round((filled / TOTAL) * 100) };
}

function row(...components: unknown[]) {
  return { type: ComponentType.ACTION_ROW, components };
}

function button(customId: string, label: string, style: number) {
  return { type: ComponentType.BUTTON, custom_id: customId, label, style };
}

/** Two rows of colour buttons; the suggested colour is highlighted first. */
function colourButtons(prefix: string, sectionId: string, suggested: PaletteColor): unknown[] {
  const ordered = [suggested, ...PALETTE_ORDER.filter((c) => c !== suggested)];
  const btns = ordered.map((c) =>
    button(`${prefix}:${sectionId}:${c}`, c === suggested ? `⭐ ${labelOf(c)}` : labelOf(c), c === suggested ? ButtonStyle.PRIMARY : ButtonStyle.SECONDARY),
  );
  return [row(...btns.slice(0, 5)), row(...btns.slice(5, 10))];
}

function openSections(cells: Map<string, PaletteColor>, bands?: string[]) {
  return SECTIONS.filter((s) => !cells.has(s.id) && (!bands || bands.includes(s.band)));
}

function regionSelect(customId = "paint:region") {
  return row({
    type: ComponentType.STRING_SELECT,
    custom_id: customId,
    placeholder: "Choose a region of the pookalam…",
    options: REGIONS.map((r) => ({ label: r.label, value: r.key })),
  });
}

// ------------------------------------------------------------------ //
// Flow: show the next petal to bloom (guided colour-by-number).
// ------------------------------------------------------------------ //
async function showBloom(token: string, sectionId: string): Promise<void> {
  const s = BY_ID.get(sectionId);
  if (!s) return;
  const cells = await fetchCells();
  const { filled, pct } = progress(cells);
  const png = renderPng(cells, { highlight: [sectionId] });
  const payload: EditPayload = {
    content: "",
    embeds: [
      {
        title: "🌸 Bloom the next petal",
        description: `The outlined petal wants **${flowerOf(s.correctColor)}** (${labelOf(s.correctColor)}).\nTap **Bloom** to fill it, pick another colour, or skip.\n\n**${filled}/${TOTAL}** petals bloomed — ${pct}% complete.`,
        color: ONAM_GOLD,
        image: { url: IMG },
      },
    ],
    components: [
      row(
        button(`bloom:do:${sectionId}:${s.correctColor}`, `🌸 Bloom ${labelOf(s.correctColor)}`, ButtonStyle.SUCCESS),
        button(`bloom:other:${sectionId}`, "🎨 Other colour", ButtonStyle.SECONDARY),
        button(`bloom:skip:${sectionId}`, "⏭️ Skip", ButtonStyle.SECONDARY),
      ),
    ],
  };
  await editOriginal(APP_ID, token, payload, png);
}

async function bloomComplete(token: string): Promise<void> {
  const cells = await fetchCells();
  const png = renderPng(cells);
  await editOriginal(
    APP_ID,
    token,
    {
      content: "",
      embeds: [
        {
          title: "🎉 The pookalam is complete!",
          description: `All **${TOTAL}** petals have bloomed. Happy Onam! 🌾`,
          color: ONAM_GOLD,
          image: { url: IMG },
        },
      ],
      components: [],
    },
    png,
  );
}

// ------------------------------------------------------------------ //
// Flow: pick a specific petal (region → numbered petal → colour).
// ------------------------------------------------------------------ //
const PAGE = 25;

async function showPaintPage(token: string, regionKey: string, offset: number): Promise<void> {
  const region = regionByKey.get(regionKey);
  if (!region) return;
  const cells = await fetchCells();
  const open = openSections(cells, region.bands);

  if (open.length === 0) {
    await editOriginal(APP_ID, token, {
      content: `✅ Every petal in **${region.label}** is already bloomed. Pick another region:`,
      embeds: [],
      components: [regionSelect()],
    });
    return;
  }

  const slice = open.slice(offset, offset + PAGE);
  const numbered = slice.map((s, i) => ({ id: s.id, n: i + 1 }));
  const png = renderPng(cells, { highlight: slice.map((s) => s.id), numbered });

  const select = {
    type: ComponentType.STRING_SELECT,
    custom_id: "paint:sec",
    placeholder: "Pick a numbered petal…",
    options: slice.map((s, i) => ({
      label: `#${i + 1} · suggested ${labelOf(s.correctColor)}`,
      value: s.id,
    })),
  };

  const components: unknown[] = [row(select)];
  const hasPrev = offset > 0;
  const hasNext = offset + PAGE < open.length;
  if (hasPrev || hasNext) {
    components.push(
      row(
        button(`paint:page:${regionKey}:${Math.max(0, offset - PAGE)}`, "◀ Prev", hasPrev ? ButtonStyle.SECONDARY : ButtonStyle.SECONDARY),
        button(`paint:page:${regionKey}:${offset + PAGE}`, "Next ▶", ButtonStyle.SECONDARY),
      ),
    );
  }

  await editOriginal(
    APP_ID,
    token,
    {
      content: "",
      embeds: [
        {
          title: `🎨 ${region.label}`,
          description: `Showing ${offset + 1}–${offset + slice.length} of ${open.length} open petals. Pick a numbered petal below.`,
          color: ONAM_GOLD,
          image: { url: IMG },
        },
      ],
      components,
    },
    png,
  );
}

async function showColourPick(token: string, sectionId: string): Promise<void> {
  const s = BY_ID.get(sectionId);
  if (!s) return;
  const cells = await fetchCells();
  const png = renderPng(cells, { highlight: [sectionId] });
  await editOriginal(
    APP_ID,
    token,
    {
      content: "",
      embeds: [
        {
          title: "🎨 Pick a colour",
          description: `Choose a flower for the outlined petal.\n⭐ = suggested (**${flowerOf(s.correctColor)}**).`,
          color: ONAM_GOLD,
          image: { url: IMG },
        },
      ],
      components: colourButtons("paint:color", sectionId, s.correctColor),
    },
    png,
  );
}

// ------------------------------------------------------------------ //
// Apply a paint, then advance the relevant flow.
// ------------------------------------------------------------------ //
async function doPaint(
  token: string,
  user: PaintUser,
  sectionId: string,
  colour: string,
  mode: "bloom" | "paint",
): Promise<void> {
  const result = await applyPaint(user, sectionId, colour);
  if (!result.ok) {
    await editOriginal(APP_ID, token, {
      content: result.status === 429 ? "⏳ Slow down a moment, then try again." : `⚠️ Couldn't paint that (${result.error}).`,
      embeds: [],
      components: [],
    });
    return;
  }
  if (result.justCompleted) {
    await bloomComplete(token);
    return;
  }

  const cells = await fetchCells();
  const { filled, pct } = progress(cells);

  if (mode === "bloom") {
    const next = openSections(cells)[0];
    if (!next) return bloomComplete(token);
    const png = renderPng(cells, { highlight: [next.id] });
    await editOriginal(
      APP_ID,
      token,
      {
        content: `🌸 You bloomed a **${labelOf(colour as PaletteColor)}** petal! (${filled}/${TOTAL} · ${pct}%)`,
        embeds: [
          {
            title: "Next petal",
            description: `This one wants **${flowerOf(next.correctColor)}** (${labelOf(next.correctColor)}).`,
            color: ONAM_GOLD,
            image: { url: IMG },
          },
        ],
        components: [
          row(
            button(`bloom:do:${next.id}:${next.correctColor}`, `🌸 Bloom ${labelOf(next.correctColor)}`, ButtonStyle.SUCCESS),
            button(`bloom:other:${next.id}`, "🎨 Other colour", ButtonStyle.SECONDARY),
            button(`bloom:skip:${next.id}`, "⏭️ Skip", ButtonStyle.SECONDARY),
          ),
        ],
      },
      png,
    );
  } else {
    const png = renderPng(cells, { highlight: [sectionId] });
    await editOriginal(
      APP_ID,
      token,
      {
        content: `🌸 Painted a **${labelOf(colour as PaletteColor)}** petal! (${filled}/${TOTAL} · ${pct}%)`,
        embeds: [{ title: "Paint another?", color: ONAM_GOLD, image: { url: IMG } }],
        components: [row(button("paint:again", "🎨 Paint another petal", ButtonStyle.PRIMARY))],
      },
      png,
    );
  }
}

// ------------------------------------------------------------------ //
// Commands.
// ------------------------------------------------------------------ //
async function cmdPookalam(token: string): Promise<void> {
  const cells = await fetchCells();
  const { filled, pct } = progress(cells);
  const png = renderPng(cells);
  await editOriginal(
    APP_ID,
    token,
    {
      embeds: [
        {
          title: "🌼 Virtual Atham Pookkalam",
          description: `Our shared carpet — **${filled}/${TOTAL}** petals bloomed (${pct}%).\nUse **/bloom** for a quick petal or **/paint** to choose a spot.`,
          color: ONAM_GOLD,
          image: { url: IMG },
          footer: { text: "Atham Pookkalam 2026 · Happy Onam 🌾" },
        },
      ],
    },
    png,
  );
}

async function cmdLeaderboard(token: string): Promise<void> {
  const { prisma } = await import("../_lib/prisma.js");
  const rows = await prisma.cell.groupBy({
    by: ["filledBy", "filledByName"],
    _count: { sectionId: true },
    orderBy: { _count: { sectionId: "desc" } },
    take: 10,
  });
  const medals = ["🥇", "🥈", "🥉"];
  const lines = rows.length
    ? rows.map((r, i) => `${medals[i] ?? `\`${i + 1}.\``} **${r.filledByName ?? "Malayali"}** — ${r._count.sectionId} petals`).join("\n")
    : "No petals bloomed yet. Be the first with **/bloom**!";
  await editOriginal(APP_ID, token, {
    embeds: [{ title: "🏆 Top contributors", description: lines, color: ONAM_GOLD }],
  });
}

// ------------------------------------------------------------------ //
// Entry point.
// ------------------------------------------------------------------ //
export default async function handler(req: Req, res: Res): Promise<void> {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.end("method not allowed");
    return;
  }

  const raw = await readRaw(req);
  const ok = verifyDiscordSignature(
    raw,
    req.headers["x-signature-ed25519"] as string | undefined,
    req.headers["x-signature-timestamp"] as string | undefined,
    PUBLIC_KEY,
  );
  if (!ok) {
    res.statusCode = 401;
    res.end("invalid request signature");
    return;
  }

  let body: any;
  try {
    body = JSON.parse(raw.toString("utf8"));
  } catch {
    res.statusCode = 400;
    res.end("bad body");
    return;
  }

  // PING → PONG (Discord endpoint verification + health checks).
  if (body.type === InteractionType.PING) {
    reply(res, { type: CallbackType.PONG });
    return;
  }

  const token: string = body.token;

  // ---- Slash commands ----
  if (body.type === InteractionType.APPLICATION_COMMAND) {
    const name: string = body.data?.name;

    switch (name) {
      case "pookalam":
        defer(res, false, () => cmdPookalam(token));
        return;
      case "leaderboard":
        defer(res, false, () => cmdLeaderboard(token));
        return;
      case "bloom": {
        defer(res, true, async () => {
          const cells = await fetchCells();
          const next = openSections(cells)[0];
          if (!next) return bloomComplete(token);
          await showBloom(token, next.id);
        });
        return;
      }
      case "paint":
        // No image/DB — respond immediately with the region menu (ephemeral).
        reply(res, {
          type: CallbackType.CHANNEL_MESSAGE,
          data: { flags: MessageFlags.EPHEMERAL, content: "Where would you like to paint?", components: [regionSelect()] },
        });
        return;
      default:
        reply(res, { type: CallbackType.CHANNEL_MESSAGE, data: { flags: MessageFlags.EPHEMERAL, content: "Unknown command." } });
        return;
    }
  }

  // ---- Buttons & select menus ----
  if (body.type === InteractionType.MESSAGE_COMPONENT) {
    const customId: string = body.data?.custom_id ?? "";
    const values: string[] = body.data?.values ?? [];
    const iu = extractUser(body);
    const parts = customId.split(":");
    const kind = parts[0];
    const action = parts[1];

    // Resolve the Profile lazily (only writes need it).
    const getUser = async (): Promise<PaintUser> =>
      iu ? resolveProfile(iu.discordId, iu.name, iu.avatarUrl) : { id: "unknown", name: "Malayali" };

    if (kind === "bloom") {
      if (action === "do") {
        const [, , sectionId, colour] = parts;
        deferUpdate(res, async () => doPaint(token, await getUser(), sectionId, colour, "bloom"));
        return;
      }
      if (action === "other") {
        const sectionId = parts[2];
        deferUpdate(res, () => showColourPickBloom(token, sectionId));
        return;
      }
      if (action === "skip") {
        const skipId = parts[2];
        deferUpdate(res, async () => {
          const cells = await fetchCells();
          const open = openSections(cells).filter((s) => s.id !== skipId);
          if (open.length === 0) return bloomComplete(token);
          const pick = open[Math.floor(Math.random() * open.length)];
          await showBloom(token, pick.id);
        });
        return;
      }
    }

    if (kind === "paint") {
      if (action === "region") {
        const regionKey = values[0];
        deferUpdate(res, () => showPaintPage(token, regionKey, 0));
        return;
      }
      if (action === "page") {
        const regionKey = parts[2];
        const offset = Number(parts[3]) || 0;
        deferUpdate(res, () => showPaintPage(token, regionKey, offset));
        return;
      }
      if (action === "sec") {
        const sectionId = values[0];
        deferUpdate(res, () => showColourPick(token, sectionId));
        return;
      }
      if (action === "color") {
        const [, , sectionId, colour] = parts;
        deferUpdate(res, async () => doPaint(token, await getUser(), sectionId, colour, "paint"));
        return;
      }
      if (action === "again") {
        deferUpdate(res, async () => {
          await editOriginal(APP_ID, token, { content: "Where would you like to paint?", embeds: [], components: [regionSelect()] });
        });
        return;
      }
    }

    // Unknown component — quietly acknowledge.
    reply(res, { type: CallbackType.DEFERRED_UPDATE_MESSAGE });
    return;
  }

  reply(res, { type: CallbackType.PONG });
}

// "Other colour" during a bloom reuses the colour picker but keeps bloom routing.
async function showColourPickBloom(token: string, sectionId: string): Promise<void> {
  const s = BY_ID.get(sectionId);
  if (!s) return;
  const cells = await fetchCells();
  const png = renderPng(cells, { highlight: [sectionId] });
  await editOriginal(
    APP_ID,
    token,
    {
      content: "",
      embeds: [
        {
          title: "🎨 Pick a colour",
          description: `Choose a flower for the outlined petal.\n⭐ = suggested (**${flowerOf(s.correctColor)}**).`,
          color: ONAM_GOLD,
          image: { url: IMG },
        },
      ],
      components: colourButtons("bloom:do", sectionId, s.correctColor),
    },
    png,
  );
}
