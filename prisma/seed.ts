/**
 * Seeds the `sections` table from the generated geometry — the single source
 * of truth. Safe to re-run (idempotent upserts). Run with `npm run db:seed`.
 */
import { PrismaClient, type PaletteColor } from "@prisma/client";
import { SECTIONS } from "../src/generated/pookkalam.geometry.ts";

const prisma = new PrismaClient();

async function main() {
  let n = 0;
  for (const s of SECTIONS) {
    await prisma.section.upsert({
      where: { id: s.id },
      create: {
        id: s.id,
        ring: s.ring,
        band: s.band,
        code: s.code,
        correctColor: s.correctColor as PaletteColor,
      },
      update: {
        ring: s.ring,
        band: s.band,
        code: s.code,
        correctColor: s.correctColor as PaletteColor,
      },
    });
    n++;
  }
  console.log(`Seeded ${n} sections.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
