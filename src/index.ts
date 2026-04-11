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
  User
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
    if (looksLegacyFlat) {
      return {};
    }

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
        if (globalPrefixes.length > 0) {
          DEFAULT_PREFIXES = globalPrefixes;
        }
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
  const dataToSave = {
    ...store,
    _global_prefixes: DEFAULT_PREFIXES
  };
  fs.writeFileSync(filePath, JSON.stringify(dataToSave, null, 2), 'utf8');
}

function ensureGuildBucket(store: GuildTextStore, guildId: string): TextStore {
  if (!store[guildId]) {
    store[guildId] = {};
  }
  return store[guildId];
}

// Data Initialization
const aliases: GuildTextStore = loadGuildTextStore(ALIAS_FILE);
const tags: GuildTextStore = loadGuildTextStore(TAG_FILE);
const prefixes: PrefixStore = loadPrefixStore(SETTINGS_FILE);
const giveaways = new Map<string, GiveawayEntry>();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent
  ]
});

// Render Web Service Health Check
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
    .addStringOption(option =>
      option
        .setName('options')
        .setDescription('Example: tea, coffee, juice')
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('roll')
    .setDescription('Roll a dice.')
    .addIntegerOption(option =>
      option
        .setName('sides')
        .setDescription('Dice sides (2-1000)')
        .setMinValue(2)
        .setMaxValue(1000)
        .setRequired(false)
    ),
  new SlashCommandBuilder().setName('coinflip').setDescription('Flip a coin.'),
  new SlashCommandBuilder()
    .setName('8ball')
    .setDescription('Ask the magic 8-ball.')
    .addStringOption(option =>
      option.setName('question').setDescription('Your question').setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('reverse')
    .setDescription('Reverse a text.')
    .addStringOption(option =>
      option.setName('text').setDescription('Text to reverse').setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('calc')
    .setDescription('Basic calculator (+ - * / and parentheses).')
    .addStringOption(option =>
      option
        .setName('expression')
        .setDescription('Example: (20+5)*3')
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Create a giveaway (opens a form).')
    .addChannelOption(option =>
      option
        .setName('channel')
        .setDescription('Channel where giveaway will be posted')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName('avatar')
    .setDescription('Show user avatar.')
    .addUserOption(option =>
      option.setName('user').setDescription('Target user').setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName('userinfo')
    .setDescription('Show user info.')
    .addUserOption(option =>
      option.setName('user').setDescription('Target user').setRequired(false)
    ),
  new SlashCommandBuilder().setName('serverinfo').setDescription('Show server info.'),
  new SlashCommandBuilder()
    .setName('role')
    .setDescription('Manage server roles.')
    .addSubcommand(sub =>
      sub
        .setName('add')
        .setDescription('Add role to user')
        .addUserOption(option =>
          option.setName('user').setDescription('Target user').setRequired(true)
        )
        .addRoleOption(option =>
          option.setName('role').setDescription('Role to add').setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('rem')
        .setDescription('Remove role from user')
        .addUserOption(option =>
          option.setName('user').setDescription('Target user').setRequired(true)
        )
        .addRoleOption(option =>
          option.setName('role').setDescription('Role to remove').setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('ren')
        .setDescription('Rename a role')
        .addRoleOption(option =>
          option.setName('role').setDescription('Role to rename').setRequired(true)
        )
        .addStringOption(option =>
          option.setName('name').setDescription('New role name').setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('create')
        .setDescription('Create a role')
        .addStringOption(option =>
          option.setName('name').setDescription('Role name').setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('del')
        .setDescription('Delete a role')
        .addRoleOption(option =>
          option.setName('role').setDescription('Role to delete').setRequired(true)
        )
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
  new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Delete multiple messages with advanced filters.')
    .addIntegerOption(opt => 
      opt.setName('amount').setDescription('Number of messages to scan (1-100)').setRequired(true).setMinValue(1).setMaxValue(100)
    )
    .addUserOption(opt => opt.setName('user').setDescription('Filter by specific user').setRequired(false))
    .addChannelOption(opt => 
      opt.setName('channel').setDescription('Target channel (default: current channel)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(false)
    )
    .addStringOption(opt => 
      opt.setName('filter').setDescription('Special message filters').addChoices(
        { name: 'Bots only', value: 'bot' },
        { name: 'Humans only', value: 'human' },
        { name: 'Contains Links', value: 'link' },
        { name: 'Contains Invites', value: 'invite' }
      ).setRequired(false)
    )
    .addStringOption(opt => opt.setName('contain').setDescription('Filter messages containing a specific word/phrase').setRequired(false))
    .addStringOption(opt => opt.setName('regex').setDescription('Filter messages by Regular Expression').setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
  new SlashCommandBuilder()
    .setName('delete')
    .setDescription('Fun fake command')
    .addSubcommand(sub =>
      sub
        .setName('server')
        .setDescription('Fake delete server command')
        .addStringOption(option =>
          option
            .setName('anything')
            .setDescription('Anything you write will be ignored')
            .setRequired(false)
        )
    ),
  new SlashCommandBuilder()
    .setName('synccommands')
    .setDescription('Sync slash commands to this server now.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName('prefix')
    .setDescription('Manage server prefix')
    .addSubcommand(sub =>
      sub
        .setName('add')
        .setDescription('Set a custom prefix')
        .addStringOption(option =>
          option
            .setName('value')
            .setDescription('New prefix (1-5 chars)')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('remove')
        .setDescription('Reset prefix to default')
    )
    .addSubcommand(sub =>
      sub
        .setName('list')
        .setDescription('Show current server prefix')
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName('say')
    .setDescription('Make the bot send text.')
    .addStringOption(option =>
      option.setName('text').setDescription('Text to send').setRequired(true)
    )
    .addChannelOption(option =>
      option
        .setName('channel')
        .setDescription('Channel to send message in')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
  new SlashCommandBuilder()
    .setName('embed')
    .setDescription('Send a custom embed.')
    .addStringOption(option =>
      option.setName('title').setDescription('Embed title').setRequired(true)
    )
    .addStringOption(option =>
      option.setName('description').setDescription('Embed description').setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('color')
        .setDescription('Hex color like #2ecc71')
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName('image')
        .setDescription('Image URL')
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName('thumbnail')
        .setDescription('Thumbnail URL')
        .setRequired(false)
    )
    .addChannelOption(option =>
      option
        .setName('channel')
        .setDescription('Channel to send embed in')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
  new SlashCommandBuilder()
    .setName('tagscript')
    .setDescription('Quickly show a tag by name.')
    .addStringOption(option =>
      option.setName('name').setDescription('Tag name').setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('alias')
    .setDescription('Create/update a trigger alias.')
    .addStringOption(option =>
      option
        .setName('trigger')
        .setDescription('Trigger text, ex: hi')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('output')
        .setDescription('Bot reply text when trigger matches')
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName('aliasdel')
    .setDescription('Delete a trigger alias.')
    .addStringOption(option =>
      option
        .setName('trigger')
        .setDescription('Trigger text to remove')
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName('aliases')
    .setDescription('List all aliases.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName('tag')
    .setDescription('Tag system')
    .addSubcommand(sub =>
      sub
        .setName('create')
        .setDescription('Create tag via modal window')
        .addStringOption(option =>
          option.setName('name').setDescription('Tag name').setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('view')
        .setDescription('View a tag')
        .addStringOption(option =>
          option.setName('name').setDescription('Tag name').setRequired(true)
        )
    )
    .addSubcommand(sub => sub.setName('list').setDescription('List all tags'))
    .addSubcommand(sub =>
      sub
        .setName('delete')
        .setDescription('Delete a tag')
        .addStringOption(option =>
          option.setName('name').setDescription('Tag name').setRequired(true)
        )
    ),
  new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a member from the server.')
    .addUserOption(option =>
      option.setName('user').setDescription('Member to kick').setRequired(true)
    )
    .addStringOption(option =>
      option.setName('reason').setDescription('Reason for kick').setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),
  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a member from the server.')
    .addUserOption(option =>
      option.setName('user').setDescription('Member to ban').setRequired(true)
    )
    .addStringOption(option =>
      option.setName('reason').setDescription('Reason for ban').setRequired(false)
    )
    .addIntegerOption(option =>
      option
        .setName('delete_days')
        .setDescription('Delete message history for N days (0-7)')
        .setMinValue(0)
        .setMaxValue(7)
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
  new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('Timeout (mute) member in minutes.')
    .addUserOption(option =>
      option.setName('user').setDescription('Member to timeout').setRequired(true)
    )
    .addIntegerOption(option =>
      option
        .setName('minutes')
        .setDescription('Duration in minutes (1-40320)')
        .setMinValue(1)
        .setMaxValue(40320)
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('reason').setDescription('Reason').setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  new SlashCommandBuilder()
    .setName('mute')
    .setDescription('Alias of /timeout.')
    .addUserOption(option =>
      option.setName('user').setDescription('Member to mute').setRequired(true)
    )
    .addIntegerOption(option =>
      option
        .setName('minutes')
        .setDescription('Duration in minutes (1-40320)')
        .setMinValue(1)
        .setMaxValue(40320)
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('reason').setDescription('Reason').setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  new SlashCommandBuilder()
    .setName('untimeout')
    .setDescription('Remove timeout from a member.')
    .addUserOption(option =>
      option.setName('user').setDescription('Member to untimeout').setRequired(true)
    )
    .addStringOption(option =>
      option.setName('reason').setDescription('Reason').setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  new SlashCommandBuilder()
    .setName('unmute')
    .setDescription('Alias of /untimeout.')
    .addUserOption(option =>
      option.setName('user').setDescription('Member to unmute').setRequired(true)
    )
    .addStringOption(option =>
      option.setName('reason').setDescription('Reason').setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
].map(command => command.toJSON());

async function registerSlashCommands(preferredGuildId?: string): Promise<{ ok: boolean }> {
  if (!CLIENT_ID) {
    console.warn('Skipping slash registration: CLIENT_ID missing in .env');
    return { ok: false };
  }

  const rest = new REST({ version: '10' }).setToken(TOKEN as string);
  const guildIdToUse = preferredGuildId || GUILD_ID;

  if (guildIdToUse) {
    try {
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID as string, guildIdToUse as string), {
        body: slashCommands
      });

      // Prevent duplicate command names in the UI when old global commands exist.
      await rest.put(Routes.applicationCommands(CLIENT_ID as string), { body: [] });

      console.log(`Registered slash commands for guild ${guildIdToUse} and cleared global commands.`);
      return { ok: true };
    } catch (error: any) {
      console.error('Guild slash registration failed:', error?.rawError || error);
    }
  }

  try {
    await rest.put(Routes.applicationCommands(CLIENT_ID as string), { body: slashCommands });
    console.log('Registered global slash commands (can take up to 1 hour to appear).');
    return { ok: true };
  } catch (error: any) {
    console.error('Global slash registration failed:', error?.rawError || error);
    return { ok: false };
  }
}

function isValidHex(color?: string): boolean {
  if (!color) r
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
