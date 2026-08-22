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
import { applyPaint, resolveProfile, fetchCells, cooldownRemainingMs, type PaintUser } from "../_lib/paint-core.js";
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

/** Human-friendly cooldown remaining, e.g. "2m 14s" or "9s". */
function fmtDuration(ms: number): string {
  const s = Math.ceil(ms / 1000);
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m > 0) return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
  return `${rem}s`;
}

function cooldownMsg(remainMs: number): string {
  return `⏳ You've bloomed recently — you can add another petal in **${fmtDuration(remainMs)}**.`;
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
async function doPaint(token: string, user: PaintUser, sectionId: string, colour: string): Promise<void> {
  const result = await applyPaint(user, sectionId, colour);
  if (!result.ok) {
    let content: string;
    if (result.error === "cooldown") {
      content = cooldownMsg((result.retryAfterSec ?? 0) * 1000);
    } else if (result.status === 429) {
      content = "⏳ Slow down a moment, then try again.";
    } else {
      content = `⚠️ Couldn't paint that (${result.error}).`;
    }
    await editOriginal(APP_ID, token, { content, embeds: [], components: [] });
    return;
  }
  if (result.justCompleted) {
    await bloomComplete(token);
    return;
  }

  // One petal per bloom — no auto-advance. Show what they placed and the cooldown.
  const cells = await fetchCells();
  const { filled, pct } = progress(cells);
  const who = user.discordId ? `<@${user.discordId}>` : user.name;
  const png = renderPng(cells, { highlight: [sectionId] });
  await editOriginal(
    APP_ID,
    token,
    {
      content: `🌸 ${who} bloomed a **${labelOf(colour as PaletteColor)}** petal! (${filled}/${TOTAL} · ${pct}%)`,
      embeds: [
        {
          title: "Come back soon 🌾",
          description: "You can bloom another petal in **3 minutes**. Run `/pookalam` any time to watch the carpet fill up.",
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

async function cmdPreview(token: string): Promise<void> {
  // Every section shown in its suggested colour — the finished design.
  const finished = new Map<string, PaletteColor>(SECTIONS.map((s) => [s.id, s.correctColor]));
  const png = renderPng(finished);
  await editOriginal(
    APP_ID,
    token,
    {
      embeds: [
        {
          title: "🌼 Finished Pookkalam — preview",
          description: "Here's the full design, with every petal in its suggested flower colour. Help bring it to life with `/bloom` or `/paint`! 🌸",
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

async function cmdStats(token: string): Promise<void> {
  const { prisma } = await import("../_lib/prisma.js");
  const [rows, totalPainted] = await Promise.all([
    prisma.cell.groupBy({
      by: ["filledBy", "filledByName"],
      _count: { sectionId: true },
      orderBy: { _count: { sectionId: "desc" } },
      take: 100,
    }),
    prisma.cell.count(),
  ]);

  if (rows.length === 0) {
    await editOriginal(APP_ID, token, {
      embeds: [{ title: "📊 Pookkalam stats", description: "No petals bloomed yet — be the first with `/bloom`! 🌸", color: ONAM_GOLD }],
    });
    return;
  }

  const pct = Math.round((totalPainted / TOTAL) * 100);
  const medals = ["🥇", "🥈", "🥉"];
  const MAX_LINES = 40;
  const list = rows
    .slice(0, MAX_LINES)
    .map((r, i) => {
      const rank = medals[i] ?? `\`${String(i + 1).padStart(2, " ")}.\``;
      const share = totalPainted ? Math.round((r._count.sectionId / totalPainted) * 100) : 0;
      const petals = r._count.sectionId;
      return `${rank} **${r.filledByName ?? "Malayali"}** — ${petals} petal${petals === 1 ? "" : "s"} (${share}%)`;
    })
    .join("\n");
  const overflow = rows.length > MAX_LINES ? `\n…and **${rows.length - MAX_LINES}** more painter${rows.length - MAX_LINES === 1 ? "" : "s"}` : "";
  const summary = `**${totalPainted}/${TOTAL}** petals bloomed · **${pct}%** complete · **${rows.length}** painter${rows.length === 1 ? "" : "s"}`;

  await editOriginal(APP_ID, token, {
    embeds: [
      {
        title: "📊 Pookkalam stats",
        description: `${summary}\n\n${list}${overflow}`,
        color: ONAM_GOLD,
        footer: { text: "Atham Pookkalam 2026 · Happy Onam 🌾" },
      },
    ],
  });
}

async function cmdAbout(token: string): Promise<void> {
  await editOriginal(APP_ID, token, {
    embeds: [
      {
        title: "🌼 Welcome to the Virtual Atham Pookkalam! 🪔",
        description:
          "Onam is around the corner! Since we can't gather in person to build a massive **Pookkalam (floral carpet)**, we brought one straight into our Discord! We have a giant shared, empty canvas, and we need *everyone's* help to fill it up with vibrant flower petals. 🌸✨\n\n" +
          "### 🎮 Available Commands:\n" +
          "• **/bloom** — **The Speedrun Mode:** The bot outlines a petal and suggests the correct traditional flower color. Just click the bloom button and boom—you've added a petal! 🌸\n" +
          "• **/paint** — **The Artist Mode:** Choose a specific region (like the center hub, the lotus petals, or the outer rim), pick a numbered petal, and paint it whatever color you want! 🎨\n" +
          "• **/pookalam** — See our gorgeous shared carpet's real-time progress and watch it fill up. 🌼\n" +
          "• **/preview** — Sneak peek! See what the finished masterpiece will look like once every petal is successfully bloomed. 👀\n" +
          "• **/leaderboard** — Show off your contribution. Who will claim the 🥇 gold medal for most petals painted? 🏆\n" +
          "• **/stats** — See the detailed stats, percentage contributions, and active painters list. 📊\n\n" +
          "### ⚡ Cooldown & Colors:\n" +
          "• **Cooldown:** There is a **3-minute cooldown** between petal placements to give everyone a turn.\n" +
          "• **Suggested Colors:** Try to match the suggested color of each petal (indicated by ⭐) to follow the original traditional pattern, or be creative with **10 flower colors**!\n\n" +
          "Get in here, run **/bloom**, and let’s get this Pookkalam looking beautiful before Onam! Happy blooming! 🌾🌸",
        color: ONAM_GOLD,
        footer: { text: "Virtual Atham 2026 · Happy Onam 🌾" },
      },
    ],
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
    const iu = extractUser(body);

    switch (name) {
      case "pookalam":
        defer(res, false, () => cmdPookalam(token));
        return;
      case "leaderboard":
        defer(res, false, () => cmdLeaderboard(token));
        return;
      case "stats":
        defer(res, false, () => cmdStats(token));
        return;
      case "preview":
        defer(res, false, () => cmdPreview(token));
        return;
      case "about":
        defer(res, false, () => cmdAbout(token));
        return;
      case "bloom": {
        // Ack first (cold-start safe), then check cooldown + build the UI.
        // Public message; only the invoker can use the buttons (guarded below).
        defer(res, false, async () => {
          const remain = iu ? await cooldownRemainingMs(iu.discordId) : 0;
          if (remain > 0) {
            await editOriginal(APP_ID, token, { content: cooldownMsg(remain), embeds: [], components: [] });
            return;
          }
          const cells = await fetchCells();
          const next = openSections(cells)[0];
          if (!next) return bloomComplete(token);
          await showBloom(token, next.id);
        });
        return;
      }
      case "paint": {
        // Ack first (cold-start safe), then check cooldown + show the region menu.
        defer(res, false, async () => {
          const remain = iu ? await cooldownRemainingMs(iu.discordId) : 0;
          if (remain > 0) {
            await editOriginal(APP_ID, token, { content: cooldownMsg(remain), embeds: [], components: [] });
            return;
          }
          await editOriginal(APP_ID, token, { content: "Where would you like to paint?", components: [regionSelect()] });
        });
        return;
      }
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

    // The message is public, but only its owner (the user who ran the command)
    // may use the buttons. Anyone else gets a private nudge.
    const invokerId: string | undefined =
      body.message?.interaction_metadata?.user?.id ?? body.message?.interaction?.user?.id;
    if (invokerId && iu && invokerId !== iu.discordId) {
      reply(res, {
        type: CallbackType.CHANNEL_MESSAGE,
        data: {
          flags: MessageFlags.EPHEMERAL,
          content: `🌸 This is <@${invokerId}>'s pookkalam. Start your own with \`/bloom\` or \`/paint\`.`,
        },
      });
      return;
    }

    // Resolve the Profile lazily (only writes need it).
    const getUser = async (): Promise<PaintUser> =>
      iu ? resolveProfile(iu.discordId, iu.name, iu.avatarUrl) : { id: "unknown", name: "Malayali" };

    if (kind === "bloom") {
      if (action === "do") {
        const [, , sectionId, colour] = parts;
        deferUpdate(res, async () => doPaint(token, await getUser(), sectionId, colour));
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
        deferUpdate(res, async () => doPaint(token, await getUser(), sectionId, colour));
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
