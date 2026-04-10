import 'dotenv/config';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  ChannelType,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  GuildMember,
  Message,
  ModalBuilder,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  User,
  TextBasedChannel
} from 'discord.js';

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
let DEFAULT_PREFIXES = ['> ', '>', 'ds-', "'", ':)'];
const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000;
const PORT = Number(process.env.PORT || 0);
const BOT_START_TIME = Date.now();

if (!TOKEN) throw new Error('Missing TOKEN in .env');

const DATA_DIR = process.env.RENDER_DISK_MOUNT_PATH || path.join(process.cwd(), 'data');
const ALIAS_FILE = path.join(DATA_DIR, 'aliases.json');
const TAG_FILE = path.join(DATA_DIR, 'tags.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

type TextStore = Record<string, string>;
type GuildTextStore = Record<string, TextStore>;
type PrefixStore = Record<string, string>;

type GiveawayEntry = {
  messageId: string;
  guildId: string;
  channelId: string;
  title: string;
  hostName: string;
  winnersCount: number;
  endAt: number;
  participants: Set<string>;
  ended: boolean;
};

function ensureStore(filePath: string): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, '{}', 'utf8');
}

function loadGuildTextStore(filePath: string): GuildTextStore {
  ensureStore(filePath);
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as any;
    if (typeof parsed !== 'object' || parsed === null) return {};
    return parsed;
  } catch { return {}; }
}

function saveStore(filePath: string, store: GuildTextStore): void {
  fs.writeFileSync(filePath, JSON.stringify(store, null, 2), 'utf8');
}

function loadPrefixStore(filePath: string): PrefixStore {
  ensureStore(filePath);
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as any;
    const res: PrefixStore = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (k === '_global_prefixes' && Array.isArray(v)) DEFAULT_PREFIXES = v;
      else if (typeof v === 'string') res[k] = v;
    }
    return res;
  } catch { return {}; }
}

function savePrefixStore(filePath: string, store: PrefixStore): void {
  fs.writeFileSync(filePath, JSON.stringify({ ...store, _global_prefixes: DEFAULT_PREFIXES }, null, 2), 'utf8');
}

const aliases = loadGuildTextStore(ALIAS_FILE);
const tags = loadGuildTextStore(TAG_FILE);
const prefixes = loadPrefixStore(SETTINGS_FILE);
const giveaways = new Map<string, GiveawayEntry>();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent
  ]
});

if (PORT) {
  http.createServer((req, res) => {
    if (req.url === '/healthz') { res.writeHead(200); res.end('ok'); return; }
    res.writeHead(200); res.end('Running');
  }).listen(PORT, '0.0.0.0');
}

const slashCommands = [
  new SlashCommandBuilder().setName('ping').setDescription('Check latency'),
  new SlashCommandBuilder().setName('purge').setDescription('Clear messages')
    .addIntegerOption(o => o.setName('amount').setDescription('1-100').setRequired(true).setMinValue(1).setMaxValue(100))
    .addUserOption(o => o.setName('user').setDescription('Filter by user')),
  new SlashCommandBuilder().setName('help').setDescription('Commands list'),
  new SlashCommandBuilder().setName('prefix').setDescription('Manage prefix')
    .addSubcommand(s => s.setName('add').setDescription('Add prefix').addStringOption(o => o.setName('value').setRequired(true)))
    .addSubcommand(s => s.setName('remove').setDescription('Reset')),
  new SlashCommandBuilder().setName('giveaway').setDescription('Start giveaway')
    .addChannelOption(o => o.setName('channel').setDescription('Where').addChannelTypes(ChannelType.GuildText).setRequired(true))
].map(c => c.toJSON());

async function registerSlashCommands() {
  if (!CLIENT_ID) return;
  const rest = new REST({ version: '10' }).setToken(TOKEN!);
  try { await rest.put(Routes.applicationCommands(CLIENT_ID), { body: slashCommands }); } catch (e) { console.error(e); }
}

function getUptimeText(): string {
  const s = Math.floor((Date.now() - BOT_START_TIME) / 1000);
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

async function executePurge(channel: any, amount: number, filterUser?: string) {
  if (!channel || !channel.bulkDelete) return { deleted: 0, error: 'Cannot purge here' };
  try {
    const msgs = await channel.messages.fetch({ limit: amount });
    const toDel = filterUser ? msgs.filter((m: Message) => m.author.id === filterUser) : msgs;
    const del = await channel.bulkDelete(toDel, true);
    return { deleted: del.size };
  } catch { return { deleted: 0, error: 'Purge failed' }; }
}

client.once(Events.ClientReady, () => { console.log('Bot Online'); registerSlashCommands(); });

client.on(Events.InteractionCreate, async i => {
  if (i.isChatInputCommand()) {
    if (i.commandName === 'ping') return i.reply(`Pong! ${client.ws.ping}ms`);
    if (i.commandName === 'purge') {
      const amt = i.options.getInteger('amount', true);
      const user = i.options.getUser('user');
      await i.deferReply({ ephemeral: true });
      const res = await executePurge(i.channel, amt, user?.id);
      return i.editReply(res.error || `Deleted ${res.deleted} messages.`);
    }
    if (i.commandName === 'giveaway') {
      const chan = i.options.getChannel('channel', true);
      const modal = new ModalBuilder().setCustomId(`ga:${chan.id}`).setTitle('Giveaway');
      const title = new TextInputBuilder().setCustomId('title').setLabel('Prize').setStyle(TextInputStyle.Short).setRequired(true);
      modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(title));
      return i.showModal(modal);
    }
  }

  if (i.isModalSubmit() && i.customId.startsWith('ga:')) {
    const chanId = i.customId.split(':')[1];
    const prize = i.fields.getTextInputValue('title');
    const chan = await client.channels.fetch(chanId);
    if (chan && chan.isTextBased()) {
      const tc = chan as TextBasedChannel;
      await tc.send(`🎉 **GIVEAWAY STARTED** 🎉\nPrize: **${prize}**`);
      return i.reply({ content: 'Started!', ephemeral: true });
    }
    return i.reply({ content: 'Failed to send.', ephemeral: true });
  }
});

client.on(Events.MessageCreate, async m => {
  if (m.author.bot || !m.guild) return;
  const prefixes = [prefixes[m.guildId], ...DEFAULT_PREFIXES].filter(Boolean);
  const prefix = prefixes.find(p => m.content.startsWith(p));
  if (!prefix) return;

  const args = m.content.slice(prefix.length).trim().split(/\s+/);
  const cmd = args.shift()?.toLowerCase();

  if (cmd === 'ping') return m.reply(`Pong! ${client.ws.ping}ms`);
  if (cmd === 'purge') {
    const amt = parseInt(args[0]);
    if (isNaN(amt) || amt < 1) return m.reply('Enter 1-100');
    const res = await executePurge(m.channel, amt);
    const rep = await m.channel.send(`Deleted ${res.deleted} messages.`);
    setTimeout(() => rep.delete().catch(() => {}), 5000);
  }
});

client.login(TOKEN);