export async function notifyCompletion(): Promise<void> {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  const botToken = process.env.DISCORD_BOT_TOKEN;
  const channelId = process.env.DISCORD_ANNOUNCEMENT_CHANNEL_ID;

  // Rich embed payload with @everyone and @here mentions
  const payload = {
    content: "@everyone @here",
    embeds: [
      {
        title: "🌸 Virtual Pookkalam Completed! 🪔",
        description: "Finally the pookalam is finished! Wait for the surprise Gifts!! 🎁\n\nAll **423 petals** have been beautifully colored by our community together. Thank you to everyone who participated in crafting this masterpiece! ❤️",
        color: 14251020, // Hex #D97706 (Onam Amber/Gold)
        fields: [
          {
            name: "💐 Total Petals",
            value: "423 / 423",
            inline: true
          },
          {
            name: "🎉 Event",
            value: "Atham Pookkalam 2026",
            inline: true
          }
        ],
        footer: {
          text: "Happy Onam! 🌾 | Virtual Pookkalam Celebration | FOXY :)"
        },
        timestamp: new Date().toISOString()
      }
    ]
  };

  if (webhookUrl) {
    try {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error(`Failed to send Discord message via Webhook: ${res.status} - ${errText}`);
      } else {
        console.log("Discord completion message sent successfully via Webhook!");
        return;
      }
    } catch (error) {
      console.error("Error sending Discord message via Webhook:", error);
    }
  }

  if (botToken && channelId) {
    try {
      const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bot ${botToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error(`Failed to send Discord message via Bot: ${res.status} - ${errText}`);
      } else {
        console.log("Discord completion message sent successfully via Bot!");
      }
    } catch (error) {
      console.error("Error sending Discord message via Bot:", error);
    }
  }

  if (!webhookUrl && (!botToken || !channelId)) {
    console.warn("Neither DISCORD_WEBHOOK_URL nor DISCORD_BOT_TOKEN + DISCORD_ANNOUNCEMENT_CHANNEL_ID is set. Skipping announcement.");
  }
}
