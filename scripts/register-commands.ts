/**
 * Register the bot's slash commands with Discord.
 *
 *   npx tsx scripts/register-commands.ts
 *
 * Registers to a single guild (instant) when DISCORD_GUILD_ID is set, otherwise
 * globally (can take up to ~1h to propagate). Needs DISCORD_BOT_TOKEN and
 * DISCORD_APPLICATION_ID in the environment (read from .env.local / .env).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// Minimal .env loader (no dependency). Handles quoted values and inline
// comments; a non-empty value overrides an earlier empty one for the same key.
function parseVal(s: string): string {
  s = s.trim();
  if (s.startsWith('"')) { const e = s.indexOf('"', 1); return e >= 0 ? s.slice(1, e) : s.slice(1); }
  if (s.startsWith("'")) { const e = s.indexOf("'", 1); return e >= 0 ? s.slice(1, e) : s.slice(1); }
  const hash = s.indexOf(" #");
  if (hash >= 0) s = s.slice(0, hash);
  return s.trim();
}
for (const file of [".env.local", ".env"]) {
  try {
    const text = readFileSync(resolve(ROOT, file), "utf8");
    for (const line of text.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=(.*)$/i);
      if (!m) continue;
      const key = m[1];
      if (process.env[key]) continue; // a real (non-empty) value already wins
      const val = parseVal(m[2]);
      if (val !== "" || process.env[key] === undefined) process.env[key] = val;
    }
  } catch {
    /* file may not exist */
  }
}

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const APP_ID = process.env.DISCORD_APPLICATION_ID || process.env.DISCORD_CLIENT_ID;
const GUILD_ID = process.env.DISCORD_GUILD_ID;

if (!TOKEN || !APP_ID) {
  console.error("Missing DISCORD_BOT_TOKEN or DISCORD_APPLICATION_ID (DISCORD_CLIENT_ID) in the environment.");
  process.exit(1);
}

const commands = [
  { name: "pookalam", description: "Show the shared Onam pookkalam and how full it is", type: 1 },
  { name: "bloom", description: "Quickly bloom the next suggested petal (guided colour-by-number)", type: 1 },
  { name: "paint", description: "Choose a specific petal and colour it", type: 1 },
  { name: "leaderboard", description: "Top pookkalam contributors", type: 1 },
  { name: "stats", description: "Who painted the pookkalam, and how much", type: 1 },
  { name: "preview", description: "Preview the finished pookkalam design", type: 1 },
  { name: "about", description: "Learn about the Virtual Atham Pookkalam bot and its commands", type: 1 },
];

const url = GUILD_ID
  ? `https://discord.com/api/v10/applications/${APP_ID}/guilds/${GUILD_ID}/commands`
  : `https://discord.com/api/v10/applications/${APP_ID}/commands`;

const res = await fetch(url, {
  method: "PUT",
  headers: { Authorization: `Bot ${TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify(commands),
});

if (!res.ok) {
  const text = await res.text();
  console.error(`Failed (${res.status}):`, text);
  
  if (res.status === 403) {
    try {
      const err = JSON.parse(text);
      if (err.code === 50001) {
        console.error("\n==========================================================================");
        console.error("🔴 DISCORD ERROR: 50001 - MISSING ACCESS");
        console.error("==========================================================================");
        if (GUILD_ID) {
          console.error(`The bot lacks the 'applications.commands' scope in the target guild (ID: ${GUILD_ID}).`);
        } else {
          console.error("The bot lacks the 'applications.commands' scope for global registration.");
        }
        console.error("To fix this, please authorize the bot with the correct scopes by visiting this URL:");
        console.error(`👉 https://discord.com/api/oauth2/authorize?client_id=${APP_ID}&permissions=0&scope=bot%20applications.commands`);
        console.error("==========================================================================\n");
      }
    } catch {
      // Ignore parsing errors
    }
  }
  process.exit(1);
}

console.log(`Registered ${commands.length} commands ${GUILD_ID ? `to guild ${GUILD_ID}` : "globally"}.`);
