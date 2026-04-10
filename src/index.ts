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
const FAKE_DELETE_MESSAGE = 'Command Successful:! The Server will gonna Delete in few Hours.';
const PORT = Number(process.env.PORT || 0);
const BOT_START_TIME = Date.now();

if (!TOKEN) {
  throw new Error('Missing TOKEN in .env');
}

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
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, '{}', 'utf8');
  }
}

function loadGuildTextStore(filePath: string): GuildTextStore {
  ensureStore(filePath);
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed !== 'object' || parsed === null) return {};

    const values = Object.values(parsed);
    const looksLegacyFlat = values.length > 0 && values.every(value => typeof value === 'string');
    if (looksLegacyFlat) return {};

    const result: GuildTextStore = {};
    for (const [guildId, bucket] of Object.entries(parsed)) {
      if (typeof bucket !== 'object' || bucket === null) continue;
      const castBucket = bucket as Record<string, unknown>;
      result[guildId] = {};
      for (const [key, value] of Object.entries(castBucket)) {
        if (typeof value === 'string') {
          result[guildId][key] = value;
        }
      }
    }
    return result;
  } catch {
    return {};
  }
}

function saveStore(filePath: string, store: GuildTextStore): void {
  fs.writeFileSync(filePath, JSON.stringify(store, null, 2), 'utf8');
}

function loadPrefixStore(filePath: string): PrefixStore {
  ensureStore(filePath);
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed !== 'object' || parsed === null) return {};

    const result: PrefixStore = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (key === '_global_prefixes' && Array.isArray(value)) {
        const globalPrefixes = value.filter(p => typeof p === 'string' && p.trim());
        if (globalPrefixes.length > 0) DEFAULT_PREFIXES = globalPrefixes;
      } else if (typeof value === 'string' && value.trim()) {
        result[key] = value.trim();
      }
    }
    return result;
  } catch {
    return {};
  }
}

function savePrefixStore(filePath: string, store: PrefixStore): void {
  const dataToSave = { ...store, _global_prefixes: DEFAULT_PREFIXES };
  fs.writeFileSync(filePath, JSON.stringify(dataToSave, null, 2), 'utf8');
}

function ensureGuildBucket(store: GuildTextStore, guildId: string): TextStore {
  if (!store[guildId]) store[guildId] = {};
  return store[guildId];
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
  http
    .createServer((req, res) => {
      if (req.url === '/healthz') {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('ok');
        return;
      }
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('Dhaniya Sir is running');
    })
    .listen(PORT, '0.0.0.0', () => {
      console.log('HTTP server listening on port ' + PORT);
    });
}

const slashCommands = [
  new SlashCommandBuilder().setName('ping').setDescription('Check bot latency.'),
  new SlashCommandBuilder().setName('uptime').setDescription('Show bot uptime.'),
  new SlashCommandBuilder().setName('help').setDescription('Show all commands.'),
  new SlashCommandBuilder().setName('guildid').setDescription('Show current server ID.'),
  new SlashCommandBuilder().setName('botinfo').setDescription('Show bot info.'),
  new SlashCommandBuilder()
    .setName('choose')
    .setDescription('Choose one option from multiple choices.')
    .addStringOption(option => option.setName('options').setDescription('tea, coffee, juice').setRequired(true)),
  new SlashCommandBuilder()
    .setName('roll')
    .setDescription('Roll a dice.')
    .addIntegerOption(option => option.setName('sides').setDescription('2-1000').setMinValue(2).setMaxValue(1000)),
  new SlashCommandBuilder().setName('coinflip').setDescription('Flip a coin.'),
  new SlashCommandBuilder()
    .setName('calc')
    .setDescription('Basic calculator.')
    .addStringOption(option => option.setName('expression').setDescription('(20+5)*3').setRequired(true)),
  new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Delete messages with filters.')
    .addIntegerOption(o => o.setName('amount').setDescription('1-100').setRequired(true).setMinValue(1).setMaxValue(100))
    .addUserOption(o => o.setName('user').setDescription('Filter by user'))
    .addChannelOption(o => o.setName('channel').setDescription('Target channel').addChannelTypes(ChannelType.GuildText))
    .addStringOption(o => o.setName('filter').setDescription('Special filters').addChoices(
        { name: 'Bots only', value: 'bot' },
        { name: 'Humans only', value: 'human' },
        { name: 'Links', value: 'link' },
        { name: 'Invites', value: 'invite' }
    ))
    .addStringOption(o => o.setName('contain').setDescription('Contains specific text'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
  new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Start a giveaway.')
    .addChannelOption(o => o.setName('channel').setDescription('Where to post').addChannelTypes(ChannelType.GuildText).setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName('avatar').setDescription('User avatar.').addUserOption(o => o.setName('user').setDescription('Target user')),
  new SlashCommandBuilder()
    .setName('role')
    .setDescription('Manage roles.')
    .addSubcommand(s => s.setName('add').setDescription('Add role').addUserOption(o => o.setName('user').setRequired(true)).addRoleOption(o => o.setName('role').setRequired(true)))
    .addSubcommand(s => s.setName('rem').setDescription('Remove role').addUserOption(o => o.setName('user').setRequired(true)).addRoleOption(o => o.setName('role').setRequired(true)))
    .addSubcommand(s => s.setName('create').setDescription('Create role').addStringOption(o => o.setName('name').setRequired(true)))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
  new SlashCommandBuilder()
    .setName('prefix')
    .setDescription('Manage prefix.')
    .addSubcommand(s => s.setName('add').setDescription('Add prefix').addStringOption(o => o.setName('value').setRequired(true)))
    .addSubcommand(s => s.setName('remove').setDescription('Reset prefix'))
    .addSubcommand(s => s.setName('list').setDescription('Show current'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName('synccommands').setDescription('Sync slash commands.').setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
].map(command => command.toJSON());

async function registerSlashCommands(preferredGuildId?: string): Promise<{ ok: boolean }> {
  if (!CLIENT_ID) return { ok: false };
  const rest = new REST({ version: '10' }).setToken(TOKEN as string);
  try {
    const route = preferredGuildId 
        ? Routes.applicationGuildCommands(CLIENT_ID, preferredGuildId) 
        : Routes.applicationCommands(CLIENT_ID);
    await rest.put(route, { body: slashCommands });
    return { ok: true };
  } catch (error) {
    console.error(error);
    return { ok: false };
  }
}

function parseDurationToken(token: string | undefined): { ok: true; ms: number; label: string } | { ok: false } {
  if (!token) return { ok: false };
  const match = token.trim().toLowerCase().match(/^(\d+)([a-z]+)?$/);
  if (!match) return { ok: false };
  const amount = Number(match[1]);
  const unit = match[2] || 'm';
  const unitMsMap: Record<string, number> = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  const ms = amount * (unitMsMap[unit[0]] || 60000);
  return { ok: true, ms, label: `${amount}${unit}` };
}

function getUptimeText(): string {
  const totalSeconds = Math.floor((Date.now() - BOT_START_TIME) / 1000);
  const d = Math.floor(totalSeconds / 86400);
  const h = Math.floor((totalSeconds % 86400) / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${d}d ${h}h ${m}m ${s}s`;
}

function buildHelpText(prefix: string): string {
  return `Prefix: ${prefix}\nCommands: ping, uptime, botinfo, choose, roll, coinflip, calc, purge, role, prefix, giveaway, avatar, help`;
}

async function executePurge(channel: any, amount: number, filters: any) {
  if (!channel || !channel.bulkDelete) return { deleted: 0, error: 'Invalid channel' };
  try {
    const fetched = await channel.messages.fetch({ limit: amount });
    const toDelete = fetched.filter((msg: Message) => {
      if (filters.userId && msg.author.id !== filters.userId) return false;
      if (filters.isBot && !msg.author.bot) return false;
      if (filters.isHuman && msg.author.bot) return false;
      if (filters.contain && !msg.content.toLowerCase().includes(filters.contain.toLowerCase())) return false;
      return true;
    });
    const deleted = await channel.bulkDelete(toDelete, true);
    return { deleted: deleted.size };
  } catch (err) { return { deleted: 0, error: 'Purge failed' }; }
}

function getGuildPrefixes(guildId?: string | null): string[] {
  const custom = guildId ? prefixes[guildId] : null;
  return custom ? [...new Set([custom, ...DEFAULT_PREFIXES])] : DEFAULT_PREFIXES;
}

function resolveMatchedPrefix(guildId: string | null | undefined, content: string): string | null {
  const candidates = [...getGuildPrefixes(guildId)].sort((a, b) => b.length - a.length);
  return candidates.find(p => content.startsWith(p)) || null;
}

client.once(Events.ClientReady, c => {
  console.log(`Ready! ${c.user.tag}`);
  registerSlashCommands();
});

async function handleSlash(interaction: ChatInputCommandInteraction) {
  const { commandName, options, guild, channel } = interaction;

  if (commandName === 'ping') return interaction.reply(`Pong! ${client.ws.ping}ms`);
  if (commandName === 'uptime') return interaction.reply(`Uptime: ${getUptimeText()}`);
  
  if (commandName === 'purge') {
    const amount = options.getInteger('amount', true);
    const user = options.getUser('user');
    const targetChannel = options.getChannel('channel') || channel;
    await interaction.deferReply({ ephemeral: true });
    const res = await executePurge(targetChannel, amount, { userId: user?.id, filter: options.getString('filter'), contain: options.getString('contain') });
    return interaction.editReply(res.error || `Deleted ${res.deleted} messages.`);
  }

  if (commandName === 'giveaway') {
    const targetChannel = options.getChannel('channel', true);
    const modal = new ModalBuilder().setCustomId(`giveaway_create:${targetChannel.id}`).setTitle('New Giveaway');
    const title = new TextInputBuilder().setCustomId('title').setLabel('Prize').setStyle(TextInputStyle.Short).setRequired(true);
    const dur = new TextInputBuilder().setCustomId('duration').setLabel('Duration (10m, 1h)').setStyle(TextInputStyle.Short).setRequired(true);
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(title), new ActionRowBuilder<TextInputBuilder>().addComponents(dur));
    return interaction.showModal(modal);
  }

  if (commandName === 'prefix') {
    if (!interaction.guildId) return;
    const sub = options.getSubcommand();
    if (sub === 'add') {
      const val = options.getString('value', true).trim();
      prefixes[interaction.guildId] = val; savePrefixStore(SETTINGS_FILE, prefixes);
      return interaction.reply(`Prefix set to ${val}`);
    }
    if (sub === 'remove') {
      delete prefixes[interaction.guildId]; savePrefixStore(SETTINGS_FILE, prefixes);
      return interaction.reply('Prefix reset.');
    }
    return interaction.reply(`Prefixes: ${getGuildPrefixes(interaction.guildId).join(', ')}`);
  }
}

client.on(Events.InteractionCreate, async i => {
  if (i.isChatInputCommand()) return handleSlash(i);

  if (i.isModalSubmit() && i.customId.startsWith('giveaway_create:')) {
    const channelId = i.customId.split(':')[1];
    const title = i.fields.getTextInputValue('title');
    const durRaw = i.fields.getTextInputValue('duration');
    const parsed = parseDurationToken(durRaw);
    if (!parsed.ok) return i.reply({ content: 'Invalid duration', ephemeral: true });

    const targetChannel = await client.channels.fetch(channelId);
    if (targetChannel?.isTextBased()) {
      const embed = new EmbedBuilder().setTitle(`Giveaway: ${title}`).setDescription(`React to join!\nEnds in: ${durRaw}`).setColor(0x00FF00);
      const msg = await targetChannel.send({ embeds: [embed] });
      return i.reply({ content: 'Giveaway started!', ephemeral: true });
    }
  }
});

client.on(Events.MessageCreate, async m => {
  if (m.author.bot || !m.guild) return;
  const prefix = resolveMatchedPrefix(m.guildId, m.content);
  if (!prefix) return;

  const args = m.content.slice(prefix.length).trim().split(/\s+/);
  const cmd = args.shift()?.toLowerCase();

  if (cmd === 'ping') return m.reply(`Pong! ${client.ws.ping}ms`);
  if (cmd === 'help') return m.reply(buildHelpText(getGuildPrefixes(m.guildId)[0]));
  if (cmd === 'purge') {
    const amt = parseInt(args[0]);
    if (isNaN(amt) || amt < 1 || amt > 100) return m.reply('Enter 1-100');
    const res = await executePurge(m.channel, amt, {});
    const reply = await m.channel.send(`Deleted ${res.deleted} messages.`);
    setTimeout(() => reply.delete().catch(() => null), 5000);
  }
});

client.login(TOKEN);