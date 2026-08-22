# 🌼 Virtual Atham — Discord Pookkalam Bot

Colour one **shared Onam pookkalam** together, entirely inside Discord. No website,
no links to click — members bloom petals with slash commands and buttons.

Runs **serverless on Vercel** via Discord's HTTP *interactions endpoint* (no always-on
gateway process), rendering the carpet to an image on each interaction.

## Commands

| Command | What it does |
| --- | --- |
| `/pookalam` | Posts the live carpet image + how full it is. |
| `/bloom` | Guided colour-by-number — highlights the next open petal + its suggested flower; tap **Bloom** to fill it and roll straight to the next. Also **Other colour** / **Skip**. |
| `/paint` | Choose a spot: region → numbered petal → colour. |
| `/leaderboard` | Top contributors by petals painted. |

Painted tiles render vivid; unpainted ones show the dark "ghost" hint of their correct
colour, so the whole carpet reads as a colour-by-number guide. On-image numbers use a
font-free 7-segment renderer, so they show up without any system fonts on the host.

## Architecture

```
Discord ──(signed interaction POST)──►  POST /api/discord/interactions   (Vercel, Node)
                                          ├─ verify Ed25519 signature (node:crypto)
                                          ├─ ack in <3s (deferred), then
                                          └─ render PNG + edit the reply via webhook
                                                   │
                                     api/_lib/paint-core.ts  ──(Prisma)──►  Postgres
```

- **3-second rule** — every image/DB action replies *deferred* immediately, then does the
  work in the background (`@vercel/functions` `waitUntil`) and edits the message.
- **Identity** — taken straight from the interaction (`member.user`) → upserts a `Profile`
  by Discord id. No OAuth / cookies.
- **One validated write path** — `api/_lib/paint-core.ts` validates the section + colour
  against the generated design, rate-limits (>15 / 10s → 429), then upserts (last-write-wins).

### Layout

```
api/discord/interactions.ts   the endpoint — verify, route, defer, edit
api/_lib/interactions.ts       signature verify, response plumbing, region grouping
api/_lib/render.ts             carpet SVG → PNG (@resvg/resvg-js), 7-segment numbers
api/_lib/paint-core.ts         validate + rate-limit + upsert (shared write path)
api/_lib/prisma.ts             Prisma client singleton
api/_lib/discord.ts            completion announcement
src/generated/                 the pookkalam geometry (single source of truth)
src/lib/                       palette + types
scripts/register-commands.ts   register slash commands with Discord
scripts/generate-pookkalam.ts  regenerate the geometry
prisma/                        schema + seed
```

## Setup

```bash
npm install
cp .env.example .env.local     # then fill in the values
```

1. **Discord Developer Portal → your application → General Information**
   - **Application ID** → `DISCORD_APPLICATION_ID`
   - **Public Key** → `DISCORD_PUBLIC_KEY`
   - Bot token (Bot tab) → `DISCORD_BOT_TOKEN`
2. Point the DB at your Prisma Postgres database (reuse the existing one, already seeded
   with 423 sections — or run `npm run db:push && npm run db:seed` for a fresh one).
3. **Register the slash commands** (instant for one guild via `DISCORD_GUILD_ID`):
   ```bash
   npm run register-commands
   ```
4. **Deploy to Vercel**, then set the portal's **Interactions Endpoint URL** to:
   ```
   https://<your-vercel-domain>/api/discord/interactions
   ```
   Discord sends a signed PING to verify it — the endpoint answers automatically.
5. In **OAuth2 → URL Generator**, tick `applications.commands` (+ `bot`), and invite the
   app to your server.

Then try `/pookalam`, then `/bloom`. 🌸
