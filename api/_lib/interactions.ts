import crypto from "node:crypto";

// ------------------------------------------------------------------ //
// Ed25519 request verification (Discord signs every interaction POST).
// ------------------------------------------------------------------ //
// SPKI DER prefix for a raw 32-byte Ed25519 public key.
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export function verifyDiscordSignature(
  rawBody: Buffer,
  signature: string | undefined,
  timestamp: string | undefined,
  publicKeyHex: string,
): boolean {
  if (!signature || !timestamp || !publicKeyHex) return false;
  try {
    const key = crypto.createPublicKey({
      key: Buffer.concat([SPKI_PREFIX, Buffer.from(publicKeyHex, "hex")]),
      format: "der",
      type: "spki",
    });
    const msg = Buffer.concat([Buffer.from(timestamp, "utf8"), rawBody]);
    return crypto.verify(null, msg, key, Buffer.from(signature, "hex"));
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ //
// Interaction / response type constants.
// ------------------------------------------------------------------ //
export const InteractionType = { PING: 1, APPLICATION_COMMAND: 2, MESSAGE_COMPONENT: 3 } as const;
export const CallbackType = {
  PONG: 1,
  CHANNEL_MESSAGE: 4,
  DEFERRED_CHANNEL_MESSAGE: 5,
  DEFERRED_UPDATE_MESSAGE: 6,
  UPDATE_MESSAGE: 7,
} as const;
export const MessageFlags = { EPHEMERAL: 64 } as const;
export const ButtonStyle = { PRIMARY: 1, SECONDARY: 2, SUCCESS: 3, DANGER: 4 } as const;
export const ComponentType = { ACTION_ROW: 1, BUTTON: 2, STRING_SELECT: 3 } as const;

export interface EditPayload {
  content?: string;
  embeds?: unknown[];
  components?: unknown[];
  attachments?: unknown[];
}

/**
 * Edit the original (deferred) response for an interaction, optionally attaching
 * a freshly-rendered PNG. Uses the interaction token — no bot auth header needed.
 */
export async function editOriginal(
  appId: string,
  token: string,
  payload: EditPayload,
  png?: Buffer,
): Promise<void> {
  const url = `https://discord.com/api/v10/webhooks/${appId}/${token}/messages/@original`;
  try {
    let res: Response;
    if (png) {
      const body = { ...payload, attachments: [{ id: 0, filename: "pookalam.png" }] };
      const fd = new FormData();
      fd.append("payload_json", JSON.stringify(body));
      fd.append("files[0]", new Blob([new Uint8Array(png)], { type: "image/png" }), "pookalam.png");
      res = await fetch(url, { method: "PATCH", body: fd });
    } else {
      res = await fetch(url, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
    }
    if (!res.ok) console.error("editOriginal failed:", res.status, await res.text());
  } catch (e) {
    console.error("editOriginal error:", e);
  }
}

// ------------------------------------------------------------------ //
// Region grouping — friendly names over the 13 raw geometry bands.
// ------------------------------------------------------------------ //
export interface Region {
  key: string;
  label: string;
  bands: string[];
}

export const REGIONS: Region[] = [
  { key: "centre", label: "Centre — hub & chakra", bands: ["hub", "chakra"] },
  { key: "violet", label: "Violet flower", bands: ["violet"] },
  { key: "ringA", label: "Inner maroon ring", bands: ["sepA"] },
  { key: "lotus", label: "Lotus petals", bands: ["bigPetal", "whitePetal"] },
  { key: "ringB", label: "Middle maroon ring", bands: ["sepB"] },
  { key: "burst1", label: "Sunburst — inner", bands: ["burst1"] },
  { key: "burst2", label: "Sunburst — middle", bands: ["burst2"] },
  { key: "ringC", label: "Outer maroon ring", bands: ["sepC"] },
  { key: "burst3", label: "Sunburst — outer", bands: ["burst3"] },
  { key: "rim", label: "Maroon rim", bands: ["rimMaroon"] },
  { key: "border", label: "Pink border", bands: ["pink"] },
];

export const regionByKey = new Map(REGIONS.map((r) => [r.key, r]));

/** The Discord user behind an interaction (member for guilds, user for DMs). */
export interface InteractionUser {
  discordId: string;
  name: string;
  avatarUrl: string | null;
}

export function extractUser(interaction: {
  member?: { user?: { id: string; username?: string; global_name?: string | null; avatar?: string | null } };
  user?: { id: string; username?: string; global_name?: string | null; avatar?: string | null };
}): InteractionUser | null {
  const u = interaction.member?.user ?? interaction.user;
  if (!u) return null;
  return {
    discordId: u.id,
    name: u.global_name || u.username || "Malayali",
    avatarUrl: u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png` : null,
  };
}
