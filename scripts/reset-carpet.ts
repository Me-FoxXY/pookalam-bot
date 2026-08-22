/**
 * Reset the pookkalam carpet.
 *
 *   npx tsx scripts/reset-carpet.ts          # dry run — shows what WOULD change
 *   npx tsx scripts/reset-carpet.ts --yes    # actually reset
 *
 * Deletes every painted petal (Cell) and clears painter stats
 * (paintCount → 0, lastActionAt → null, which also lifts cooldowns).
 * Painter Profiles and the immutable Section design are preserved.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

function parseVal(s: string): string {
  s = s.trim();
  if (s.startsWith('"')) { const e = s.indexOf('"', 1); return e >= 0 ? s.slice(1, e) : s.slice(1); }
  if (s.startsWith("'")) { const e = s.indexOf("'", 1); return e >= 0 ? s.slice(1, e) : s.slice(1); }
  const h = s.indexOf(" #"); if (h >= 0) s = s.slice(0, h); return s.trim();
}
for (const file of [".env.local", ".env"]) {
  try {
    for (const line of readFileSync(resolve(ROOT, file), "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=(.*)$/i);
      if (!m) continue;
      if (process.env[m[1]]) continue;
      const v = parseVal(m[2]);
      if (v !== "" || process.env[m[1]] === undefined) process.env[m[1]] = v;
    }
  } catch {}
}

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();

const [cells, profiles] = await Promise.all([prisma.cell.count(), prisma.profile.count()]);
console.log(`Current state: ${cells} painted petals, ${profiles} painter profiles.`);

if (!process.argv.includes("--yes")) {
  console.log("\nDRY RUN — nothing changed. Re-run with --yes to reset:");
  console.log(`  • delete ${cells} petals`);
  console.log(`  • reset paintCount → 0 and lastActionAt → null on ${profiles} profiles`);
  await prisma.$disconnect();
  process.exit(0);
}

const del = await prisma.cell.deleteMany({});
const upd = await prisma.profile.updateMany({ data: { paintCount: 0, lastActionAt: null } });
const after = await prisma.cell.count();
console.log(`\n✅ Reset done: deleted ${del.count} petals, cleared stats on ${upd.count} profiles. Petals now: ${after}.`);
await prisma.$disconnect();
process.exit(0);
