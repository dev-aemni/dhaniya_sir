import { ActivityType, Client, PresenceStatusData } from 'discord.js';
import { PRESENCE_ROTATION_MS } from '../config';

const statuses: { name: string; type: ActivityType }[] = [
  { name: 'Dhaniya Sir Control Panel', type: ActivityType.Playing },
  { name: 'tickets and moderation', type: ActivityType.Watching },
  { name: 'custom embeds', type: ActivityType.Listening },
  { name: 'premium server tools', type: ActivityType.Streaming },
  { name: 'Doing Sex with Dhaniya\'s gf!', type: ActivityType.Streaming },
  { name: 'Doing Sex with Dhaniya\'s gf!', type: ActivityType.Streaming },
  { name: 'Doing Sex with Dhaniya\'s gf!', type: ActivityType.Streaming },
  { name: 'Doing Sex with Dhaniya\'s gf!', type: ActivityType.Streaming },
  { name: 'Doing Sex with Dhaniya\'s gf!', type: ActivityType.Streaming },
  { name: 'Doing Sex with Dhaniya\'s gf!', type: ActivityType.Streaming },
  { name: 'Doing Sex with Dhaniya\'s gf!', type: ActivityType.Streaming },
  { name: 'Doing Sex with Dhaniya\'s gf!', type: ActivityType.Streaming },
  { name: 'Doing Sex with Dhaniya\'s gf -KUSO!', type: ActivityType.Streaming },
];

function applyPresence(client: Client, index: number): void {
  const current = statuses[index % statuses.length];
  const status: PresenceStatusData = 'idle';
  client.user?.setPresence({
    status,
    activities: [
      {
        name: current.name,
        type: current.type,
        url: current.type === ActivityType.Streaming ? 'https://www.twitch.tv/discord' : undefined,
      },
    ],
  });
}

export function startPresenceRotation(client: Client): void {
  let idx = 0;
  applyPresence(client, idx);
  setInterval(() => {
    idx++;
    applyPresence(client, idx);
  }, Math.max(10000, PRESENCE_ROTATION_MS));
}
