import { PrismaClient } from "@prisma/client";
import { withAccelerate } from "@prisma/extension-accelerate";

// Prisma Postgres connections go through Accelerate. Reuse a single client
// across warm serverless invocations to avoid exhausting connections.
type Client = ReturnType<typeof make>;
function make() {
  return new PrismaClient().$extends(withAccelerate());
}

const g = globalThis as unknown as { __prisma?: Client };

// Lazy singleton: the client is only constructed on first use. If DATABASE_URL
// is missing (e.g. local dev without a DB) construction throws *inside* the
// calling handler's try/catch rather than crashing the process at import time.
export const prisma = new Proxy({} as Client, {
  get(_t, prop) {
    if (!g.__prisma) g.__prisma = make();
    return Reflect.get(g.__prisma as object, prop, g.__prisma);
  },
});
