import { ActivityType, Client, PresenceStatusData } from 'discord.js';
import { PRESENCE_ROTATION_MS } from '../config';

const statuses: { name: string; type: ActivityType }[] = [
  // Bot related
  { name: 'Dhaniya Sir Control Panel', type: ActivityType.Playing },
  { name: 'tickets and moderation', type: ActivityType.Watching },
  { name: 'custom embeds', type: ActivityType.Listening },
  { name: 'premium server tools', type: ActivityType.Streaming },

  // Aesthetic
  { name: '☾⋆ staring at the void', type: ActivityType.Watching },
  { name: '𖤐 lost between packets', type: ActivityType.Playing },
  { name: '☁ dreaming in binary', type: ActivityType.Listening },
  { name: '✦ somewhere beyond localhost', type: ActivityType.Watching },
  { name: '∞ uptime > motivation', type: ActivityType.Playing },

  // Programmer
  { name: 'fixing bugs, creating features', type: ActivityType.Playing },
  { name: 'console.log(my_life)', type: ActivityType.Playing },
  { name: '404: motivation not found', type: ActivityType.Playing },
  { name: 'npm install happiness', type: ActivityType.Playing },
  { name: 'while(alive){code();}', type: ActivityType.Playing },
  { name: 'sudo make me a sandwich', type: ActivityType.Playing },
  { name: 'awaiting better days...', type: ActivityType.Listening },

  // Sad / Deep
  { name: 'some stars shine alone ✧', type: ActivityType.Listening },
  { name: 'memories cached forever', type: ActivityType.Watching },
  { name: 'everything returns null', type: ActivityType.Playing },
  { name: 'old chats, new regrets', type: ActivityType.Listening },
  { name: 'the moon understands silence ☾', type: ActivityType.Watching },
  { name: 'time heals, logs remember', type: ActivityType.Listening },

  // Funny
  { name: 'eating RAM for breakfast', type: ActivityType.Playing },
  { name: 'stealing your bandwidth', type: ActivityType.Watching },
  { name: 'running on coffee.exe', type: ActivityType.Playing },
  { name: 'certified keyboard destroyer', type: ActivityType.Playing },
  { name: 'professional button clicker', type: ActivityType.Playing },

  // Unicode aesthetic
  { name: '⋆｡°✩ loading dreams...', type: ActivityType.Listening },
  { name: '✧･ﾟ: *✧･ﾟ:*', type: ActivityType.Watching },
  { name: '𓆩♡𓆪', type: ActivityType.Listening },
  { name: 'ミ★ lost signal ★彡', type: ActivityType.Watching },
  { name: '☄ traversing the cosmos', type: ActivityType.Playing },
  { name: '⟡ connecting...', type: ActivityType.Watching },

  // Proverbs / Quotes
  { name: 'The quieter the code, the louder it works.', type: ActivityType.Listening },
  { name: 'Stars can\'t shine without darkness.', type: ActivityType.Listening },
  { name: 'Every timeout teaches patience.', type: ActivityType.Listening },
  { name: 'Not every lost packet is gone forever.', type: ActivityType.Listening },
  { name: 'Silence speaks in hexadecimal.', type: ActivityType.Listening },

  // Anime / internet vibe
  { name: 'yamete kudasai, bugs!', type: ActivityType.Playing },
  { name: 'baka compiler >:(', type: ActivityType.Playing },
  { name: 'powered by insomnia', type: ActivityType.Playing },
  { name: 'main character syndrome.exe', type: ActivityType.Playing },

  // Extra fancy
  { name: '𝓭𝓻𝓲𝓯𝓽𝓲𝓷𝓰 𝓽𝓱𝓻𝓸𝓾𝓰𝓱 𝓽𝓱𝓮 𝓷𝓮𝓽', type: ActivityType.Watching },
  { name: '𝕮𝖔𝖉𝖊. 𝕮𝖗𝖆𝖘𝖍. 𝕽𝖊𝖕𝖊𝖆𝖙.', type: ActivityType.Playing },
  { name: 'ａｅｓｔｈｅｔｉｃ　ｐｉｎｇ', type: ActivityType.Listening },
  { name: '🖤 𝙘𝙖𝙘𝙝𝙚𝙙 𝙢𝙚𝙢𝙤𝙧𝙞𝙚𝙨', type: ActivityType.Watching },
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
