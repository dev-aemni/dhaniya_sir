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
  TextChannel,
  NewsChannel,
  ThreadChannel
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
  if (!color) return true;
  return /^#?[0-9a-fA-F]{6}$/.test(color.trim());
}

function normalizeHex(color?: string): number | undefined {
  if (!color) return undefined;
  const cleaned = color.trim().replace('#', '');
  return Number.parseInt(cleaned, 16);
}

function parseDurationToken(token: string | undefined):
  | { ok: true; ms: number; label: string }
  | { ok: false; error: 'invalid' | 'too_long' } {
  if (!token) return { ok: false, error: 'invalid' };

  const match = token.trim().toLowerCase().match(/^(\d+)([a-z]+)?$/);
  if (!match) return { ok: false, error: 'invalid' };

  const amount = Number(match[1]);
  const unit = match[2] || 'min';

  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: 'invalid' };
  }

  const unitMsMap: Record<string, number> = {
    s: 1000, sec: 1000, second: 1000, seconds: 1000,
    m: 60 * 1000, min: 60 * 1000, minute: 60 * 1000, minutes: 60 * 1000,
    h: 60 * 60 * 1000, hr: 60 * 60 * 1000, hour: 60 * 60 * 1000, hours: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000, day: 24 * 60 * 60 * 1000, days: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000, week: 7 * 24 * 60 * 60 * 1000, weeks: 7 * 24 * 60 * 60 * 1000,
    mon: 30 * 24 * 60 * 60 * 1000, month: 30 * 24 * 60 * 60 * 1000, months: 30 * 24 * 60 * 60 * 1000,
    y: 365 * 24 * 60 * 60 * 1000, year: 365 * 24 * 60 * 60 * 1000, years: 365 * 24 * 60 * 60 * 1000
  };

  const unitMs = unitMsMap[unit];
  if (!unitMs) return { ok: false, error: 'invalid' };

  const ms = amount * unitMs;
  if (ms > MAX_TIMEOUT_MS) return { ok: false, error: 'too_long' };

  return { ok: true, ms, label: `${amount}${unit}` };
}

function buildHelpText(prefixValue: string = DEFAULT_PREFIXES[0]): string {
  return [
    `Prefix: ${prefixValue}`,
    '',
    'Main:',
    `${prefixValue}help`,
    `${prefixValue}ping`,
    `${prefixValue}uptime`,
    `${prefixValue}botinfo`,
    `${prefixValue}choose <option1 | option2 | option3>`,
    `${prefixValue}roll [sides]`,
    `${prefixValue}coinflip`,
    `${prefixValue}8ball <question>`,
    `${prefixValue}reverse <text>`,
    `${prefixValue}calc <expression>`,
    `${prefixValue}prefix add <newprefix>`,
    `${prefixValue}prefix remove`,
    `${prefixValue}prefix list`,
    `${prefixValue}dicebattle @user`,
    `${prefixValue}coinbattle @user`,
    `${prefixValue}avatar [@user]`,
    `${prefixValue}userinfo [@user]`,
    `${prefixValue}serverinfo`,
    `${prefixValue}role add @user @Role`,
    `${prefixValue}role rem @user @Role | role ren @Role name:<new name>`,
    `${prefixValue}role create <name> | role del @Role`,
    `${prefixValue}delete server [anything]`,
    `${prefixValue}guildid`,
    `${prefixValue}synccommands`,
    `${prefixValue}say [#channel] <text>`,
    `${prefixValue}embed [#channel] |title|description|#hex(optional)|image_url(optional)|thumbnail_url(optional)`,
    '',
    'Aliases:',
    `${prefixValue}alias <trigger> <output text>`,
    `${prefixValue}unalias <trigger>`,
    `${prefixValue}aliases`,
    '',
    'Tags:',
    `${prefixValue}tag <name>`,
    `${prefixValue}tagcreate <name> <content>`,
    `${prefixValue}tagscript <name>`,
    `${prefixValue}tagdelete <name>`,
    `${prefixValue}tags`,
    '',
    'Moderation:',
    `${prefixValue}purge <1-100> [@user] [bot|human|link|invite] [contain text] [regex pattern]`,
    `${prefixValue}kick @user [reason]`,
    `${prefixValue}ban @user [reason]`,
    `${prefixValue}mute/@timeout @user <10min/30sec/2hour/1day/1week/1mon/1y> [reason]`,
    `${prefixValue}unmute/@untimeout @user [reason]`,
    '',
    'Slash:',
    '/uptime /botinfo /choose /roll /coinflip /8ball /reverse /calc /giveaway /role /prefix /avatar /userinfo /serverinfo /delete server /alias /aliasdel /aliases /tag /tagscript /say /embed /purge /kick /ban /mute /timeout /unmute /untimeout'
  ].join('\n');
}

async function sendToChannel(
  channel: any,
  payload: string | { embeds?: EmbedBuilder[]; components?: any[]; content?: string }
): Promise<any | null> {
  if (channel && typeof channel.send === 'function') {
    return channel.send(payload);
  }
  return null;
}

async function executePurge(
  channel: any,
  amount: number,
  filters: {
    userId?: string;
    isBot?: boolean;
    isHuman?: boolean;
    hasLink?: boolean;
    hasInvite?: boolean;
    contain?: string;
    regex?: RegExp;
  }
): Promise<{ deleted: number; error?: string }> {
  if (!channel || !('messages' in channel)) return { deleted: 0, error: 'Cannot purge in this channel type.' };
  
  try {
    const fetched = await channel.messages.fetch({ limit: amount });
    const fourteenDaysAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;

    const toDelete = fetched.filter((msg: Message) => {
      if (msg.createdTimestamp < fourteenDaysAgo) return false;
      if (filters.userId && msg.author.id !== filters.userId) return false;
      if (filters.isBot && !msg.author.bot) return false;
      if (filters.isHuman && msg.author.bot) return false;
      if (filters.hasLink && !/(https?:\/\/[^\s]+)/.test(msg.content)) return false;
      if (filters.hasInvite && !/(discord\.gg\/|discord\.com\/invite\/)/i.test(msg.content)) return false;
      if (filters.contain && !msg.content.toLowerCase().includes(filters.contain.toLowerCase())) return false;
      if (filters.regex && !filters.regex.test(msg.content)) return false;
      return true;
    });

    if (toDelete.size === 0) return { deleted: 0 };
    
    const deletedMessages = await channel.bulkDelete(toDelete, true);
    return { deleted: deletedMessages.size };
  } catch (err) {
    console.error('Purge error:', err);
    return { deleted: 0, error: 'Failed to delete messages. Make sure they are not older than 14 days and I have Manage Messages permission.' };
  }
}

async function runModerationAction(params: {
  action: 'kick' | 'ban' | 'timeout' | 'untimeout';
  moderatorMember: GuildMember;
  targetMember: GuildMember | null;
  targetUser: User;
  reason?: string;
  timeoutMs?: number;
  timeoutLabel?: string;
  deleteDays?: number;
  reply: (text: string) => Promise<void>;
}): Promise<void> {
  const { action, moderatorMember, targetMember, targetUser, reason, timeoutMs, timeoutLabel, deleteDays, reply } = params;

  const guild = moderatorMember.guild;
  const botMember = guild.members.me;
  const safeReason = reason || `No reason provided (by ${moderatorMember.user.tag})`;
  const nowString = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const sendDmNotice = async (content: string): Promise<void> => {
    try { await targetUser.send(content); } catch { }
  };

  if (!botMember) { await reply('Bot member is not ready. Try again.'); return; }
  if (targetUser.id === moderatorMember.id) { await reply('You cannot moderate yourself.'); return; }
  if (targetUser.id === client.user?.id) { await reply('I cannot moderate myself.'); return; }

  if (action === 'kick') {
    if (!moderatorMember.permissions.has(PermissionFlagsBits.KickMembers)) { await reply('You need `Kick Members` permission.'); return; }
    if (!botMember.permissions.has(PermissionFlagsBits.KickMembers)) { await reply('I need `Kick Members` permission.'); return; }
    if (!targetMember || !targetMember.kickable) { await reply('I cannot kick that user (not in server or role hierarchy issue).'); return; }
    await targetMember.kick(safeReason);
    await sendDmNotice(`You were kicked from **${guild.name}**.\nBy: **${moderatorMember.user.tag}**\nReason: ${safeReason}`);
    await reply(`Kicked **${targetUser.tag}**. Reason: ${safeReason}`);
    return;
  }

  if (action === 'ban') {
    if (!moderatorMember.permissions.has(PermissionFlagsBits.BanMembers)) { await reply('You need `Ban Members` permission.'); return; }
    if (!botMember.permissions.has(PermissionFlagsBits.BanMembers)) { await reply('I need `Ban Members` permission.'); return; }
    const deleteMessageSeconds = Math.max(0, Math.min(7, Number(deleteDays || 0))) * 86400;
    await guild.members.ban(targetUser.id, { reason: safeReason, deleteMessageSeconds });
    await sendDmNotice(`You were banned from **${guild.name}**.\nBy: **${moderatorMember.user.tag}**\nReason: ${safeReason}`);
    await reply(`Banned **${targetUser.tag}**. Reason: ${safeReason}`);
    return;
  }

  if (action === 'timeout') {
    if (!moderatorMember.permissions.has(PermissionFlagsBits.ModerateMembers)) { await reply('You need `Moderate Members` permission.'); return; }
    if (!botMember.permissions.has(PermissionFlagsBits.ModerateMembers)) { await reply('I need `Moderate Members` permission.'); return; }
    if (!targetMember || !targetMember.moderatable || !timeoutMs) { await reply('I cannot timeout that user.'); return; }
    await targetMember.timeout(timeoutMs, safeReason);
    await reply(`Timed out **${targetUser.tag}** for **${timeoutLabel || 'custom'}**. Reason: ${safeReason}`);
    return;
  }

  if (action === 'untimeout') {
    if (!moderatorMember.permissions.has(PermissionFlagsBits.ModerateMembers)) { await reply('You need `Moderate Members` permission.'); return; }
    if (!botMember.permissions.has(PermissionFlagsBits.ModerateMembers)) { await reply('I need `Moderate Members` permission.'); return; }
    if (!targetMember || !targetMember.moderatable) { await reply('I cannot untimeout that user.'); return; }
    await targetMember.timeout(null, safeReason);
    await reply(`Removed timeout from **${targetUser.tag}**. Reason: ${safeReason}`);
  }
}

function getGuildPrefixes(guildId?: string | null): string[] {
  if (!guildId) return DEFAULT_PREFIXES;
  const customPrefix = prefixes[guildId];
  if (customPrefix) { return [...new Set([customPrefix, ...DEFAULT_PREFIXES])]; }
  return DEFAULT_PREFIXES;
}

function getPrimaryPrefix(guildId?: string | null): string {
  return getGuildPrefixes(guildId)[0];
}

function resolveMatchedPrefix(guildId: string | null | undefined, content: string): string | null {
  const candidates = [...getGuildPrefixes(guildId)].sort((left, right) => right.length - left.length);
  return candidates.find(prefix => content.startsWith(prefix)) || null;
}

function getAliasReply(guildId: string | null | undefined, input: string): string | null {
  if (!guildId) return null;
  const key = input.trim().toLowerCase();
  return aliases[guildId]?.[key] || null;
}

function sanitizeKey(raw: string): string {
  return raw.trim().toLowerCase();
}

function pickMentionedChannelFromToken(token: string | undefined): string | null {
  if (!token) return null;
  const match = token.match(/^<#(\d+)>$/);
  return match ? match[1] : null;
}

function getUptimeText(): string {
  const totalSeconds = Math.floor((Date.now() - BOT_START_TIME) / 1000);
  const d = Math.floor(totalSeconds / 86400);
  const h = Math.floor((totalSeconds % 86400) / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${d}d ${h}h ${m}m ${s}s`;
}

function chooseRandom<T>(items: T[]): T { return items[Math.floor(Math.random() * items.length)]; }

function safeCalculate(expression: string): number | null {
  const trimmed = expression.trim();
  if (!trimmed || !/^[0-9+\-*/().\s]+$/.test(trimmed)) return null;
  try {
    const result = Function(`"use strict"; return (${trimmed});`)();
    if (typeof result !== 'number' || !Number.isFinite(result)) return null;
    return result;
  } catch { return null; }
}

function buildGiveawayEmbed(giveaway: GiveawayEntry): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(`Giveaway: ${giveaway.title}`)
    .setDescription('Click **Participate!** below to join the giveaway.')
    .setColor(giveaway.ended ? 0x777777 : 0x00b894)
    .addFields(
      { name: 'Host', value: giveaway.hostName, inline: true },
      { name: 'Winners', value: String(giveaway.winnersCount), inline: true },
      { name: 'Participants', value: String(giveaway.participants.size), inline: true },
      { name: 'Ends', value: `<t:${Math.floor(giveaway.endAt / 1000)}:R>`, inline: false }
    )
    .setFooter({ text: giveaway.ended ? 'Giveaway ended' : 'Good luck!' });
}

function createGiveawayRow(disabled: boolean): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('giveaway_join').setLabel('Participate!').setStyle(ButtonStyle.Success).setDisabled(disabled)
  );
}

function scheduleGiveawayEnd(giveawayId: string): void {
  const giveaway = giveaways.get(giveawayId);
  if (!giveaway || giveaway.ended) return;
  const remaining = giveaway.endAt - Date.now();
  if (remaining <= 0) { void endGiveaway(giveawayId); return; }
  setTimeout(() => { void endGiveaway(giveawayId); }, Math.min(remaining, 2147483647));
}

async function endGiveaway(giveawayId: string): Promise<void> {
  const giveaway = giveaways.get(giveawayId);
  if (!giveaway || giveaway.ended) return;
  giveaway.ended = true;
  const channel = await client.channels.fetch(giveaway.channelId).catch(() => null) as any;
  if (!channel) return;
  const giveawayMessage = await channel.messages.fetch(giveaway.messageId).catch(() => null);
  if (!giveawayMessage) return;
  const winners = [...giveaway.participants].sort(() => Math.random() - 0.5).slice(0, giveaway.winnersCount);
  await giveawayMessage.edit({ embeds: [buildGiveawayEmbed(giveaway).setColor(0x636e72)], components: [createGiveawayRow(true)] }).catch(() => null);
  if (winners.length === 0) { await channel.send(`Giveaway ended for **${giveaway.title}**. No participants.`); }
  else { await channel.send(`Giveaway ended for **${giveaway.title}**.\nWinner(s): ${winners.map(id => `<@${id}>`).join(', ')}`); }
}

async function handleSlash(interaction: ChatInputCommandInteraction): Promise<void> {
  const name = interaction.commandName;

  if (name === 'ping') { await interaction.reply(`Pong! ${client.ws.ping}ms`); return; }
  if (name === 'uptime') { await interaction.reply(`Uptime: **${getUptimeText()}**`); return; }
  if (name === 'help') { await interaction.reply({ content: buildHelpText(getPrimaryPrefix(interaction.guildId)), ephemeral: true }); return; }
  if (name === 'guildid') { await interaction.reply({ content: `Guild ID: ${interaction.guildId || 'N/A'}`, ephemeral: true }); return; }
  if (name === 'botinfo') { await interaction.reply(`Bot: **${client.user?.tag}**\nServers: **${client.guilds.cache.size}**\nUptime: **${getUptimeText()}**`); return; }
  
  if (name === 'choose') {
    const options = interaction.options.getString('options', true).split(',').map(o => o.trim()).filter(Boolean);
    if (options.length < 2) { await interaction.reply('Provide at least 2 options.'); return; }
    await interaction.reply(`I choose: **${chooseRandom(options)}**`);
    return;
  }

  if (name === 'roll') {
    const sides = interaction.options.getInteger('sides') || 6;
    await interaction.reply(`Rolled d${sides}: **${Math.floor(Math.random() * sides) + 1}**`);
    return;
  }

  if (name === 'coinflip') { await interaction.reply(`Coin: **${Math.random() < 0.5 ? 'Heads' : 'Tails'}**`); return; }

  if (name === 'calc') {
    const res = safeCalculate(interaction.options.getString('expression', true));
    await interaction.reply(res !== null ? `Result: **${res}**` : 'Invalid expression.');
    return;
  }

  if (name === 'giveaway') {
    const channel = interaction.options.getChannel('channel', true);
    const modal = new ModalBuilder().setCustomId(`giveaway_create:${channel.id}:${interaction.guildId}`).setTitle('Create Giveaway');
    const durationInput = new TextInputBuilder().setCustomId('duration').setLabel('Duration (ex: 10min, 1day)').setStyle(TextInputStyle.Short).setRequired(true);
    const titleInput = new TextInputBuilder().setCustomId('title').setLabel('Title / Prize').setStyle(TextInputStyle.Short).setRequired(true);
    const winnersInput = new TextInputBuilder().setCustomId('winners').setLabel('Winners Count').setStyle(TextInputStyle.Short).setRequired(true).setValue('1');
    const hostInput = new TextInputBuilder().setCustomId('host').setLabel('Host Name').setStyle(TextInputStyle.Short).setRequired(true).setValue(interaction.user.tag);
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(durationInput), new ActionRowBuilder<TextInputBuilder>().addComponents(titleInput), new ActionRowBuilder<TextInputBuilder>().addComponents(winnersInput), new ActionRowBuilder<TextInputBuilder>().addComponents(hostInput));
    await interaction.showModal(modal);
    return;
  }

  if (name === 'synccommands') {
    await interaction.deferReply({ ephemeral: true });
    const result = await registerSlashCommands(interaction.guildId || undefined);
    await interaction.editReply(result.ok ? 'Commands synced.' : 'Sync failed.');
    return;
  }

  if (name === 'prefix') {
    if (!interaction.guildId) return;
    const sub = interaction.options.getSubcommand();
    if (sub === 'add') {
      const val = interaction.options.getString('value', true).trim();
      if (val.length > 5) { await interaction.reply({ content: 'Max 5 chars.', ephemeral: true }); return; }
      prefixes[interaction.guildId] = val; savePrefixStore(SETTINGS_FILE, prefixes);
      await interaction.reply(`Prefix set to \`${val}\``);
    } else if (sub === 'remove') {
      delete prefixes[interaction.guildId]; savePrefixStore(SETTINGS_FILE, prefixes);
      await interaction.reply('Prefix reset to defaults.');
    } else {
      await interaction.reply(`Active prefixes: \`${getGuildPrefixes(interaction.guildId).join('`, `')}\``);
    }
    return;
  }

  if (name === 'purge') {
    const amount = interaction.options.getInteger('amount', true);
    const user = interaction.options.getUser('user');
    const targetChannel = interaction.options.getChannel('channel') || interaction.channel;
    const filterType = interaction.options.getString('filter');
    const contain = interaction.options.getString('contain') || undefined;
    const regexStr = interaction.options.getString('regex');
    let regexPattern: RegExp | undefined;
    if (regexStr) { try { regexPattern = new RegExp(regexStr); } catch { return void interaction.reply({ content: 'Invalid Regex.', ephemeral: true }); } }
    await interaction.deferReply({ ephemeral: true });
    const result = await executePurge(targetChannel, amount, { userId: user?.id, isBot: filterType === 'bot', isHuman: filterType === 'human', hasLink: filterType === 'link', hasInvite: filterType === 'invite', contain, regex: regexPattern });
    await interaction.editReply(result.error || `Deleted **${result.deleted}** messages.`);
    return;
  }

  if (name === 'say') {
    const text = interaction.options.getString('text', true);
    const channel = interaction.options.getChannel('channel') || interaction.channel;
    await interaction.reply({ content: 'Sent.', ephemeral: true });
    await sendToChannel(channel, text);
    return;
  }

  if (name === 'avatar') {
    const user = interaction.options.getUser('user') || interaction.user;
    await interaction.reply(`Avatar of **${user.tag}**: ${user.displayAvatarURL({ size: 1024 })}`);
    return;
  }

  if (name === 'role') {
    if (!interaction.guild || !(interaction.member instanceof GuildMember)) return;
    const bot = interaction.guild.members.me;
    if (!bot || !bot.permissions.has(PermissionFlagsBits.ManageRoles)) { await interaction.reply('I need Manage Roles permission.'); return; }
    const sub = interaction.options.getSubcommand();
    if (sub === 'create') {
      const r = await interaction.guild.roles.create({ name: interaction.options.getString('name', true) });
      await interaction.reply(`Created ${r}`);
    } else if (sub === 'add' || sub === 'rem') {
      const u = interaction.options.getUser('user', true);
      const r = interaction.options.getRole('role', true) as any;
      const m = await interaction.guild.members.fetch(u.id);
      if (sub === 'add') await m.roles.add(r); else await m.roles.remove(r);
      await interaction.reply('Done.');
    }
    return;
  }
}

client.once(Events.ClientReady, async readyClient => {
  console.log(`Dhaniya Sir is online as ${readyClient.user.tag}!`);
  await registerSlashCommands();
});

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isChatInputCommand()) { await handleSlash(interaction); return; }
    if (interaction.isModalSubmit() && interaction.customId.startsWith('giveaway_create:')) {
      const [, channelId, guildId] = interaction.customId.split(':');
      const durationRaw = interaction.fields.getTextInputValue('duration');
      const title = interaction.fields.getTextInputValue('title');
      const winnersCount = parseInt(interaction.fields.getTextInputValue('winners')) || 1;
      const hostName = interaction.fields.getTextInputValue('host');
      const parsed = parseDurationToken(durationRaw);
      if (!parsed.ok) { await interaction.reply({ content: 'Invalid duration.', ephemeral: true }); return; }
      const channel = await client.channels.fetch(channelId!) as any;
      const giveaway: GiveawayEntry = { messageId: '', guildId: guildId!, channelId: channelId!, title, hostName, winnersCount, endAt: Date.now() + parsed.ms, participants: new Set(), ended: false };
      const sent = await channel.send({ embeds: [buildGiveawayEmbed(giveaway)], components: [createGiveawayRow(false)] });
      giveaway.messageId = sent.id;
      giveaways.set(sent.id, giveaway);
      scheduleGiveawayEnd(sent.id);
      await interaction.reply({ content: 'Giveaway started!', ephemeral: true });
      return;
    }
    if (interaction.isButton() && interaction.customId === 'giveaway_join') {
      const giveaway = giveaways.get(interaction.message.id);
      if (!giveaway || giveaway.ended) { await interaction.reply({ content: 'Ended.', ephemeral: true }); return; }
      if (giveaway.participants.has(interaction.user.id)) { await interaction.reply({ content: 'Already joined.', ephemeral: true }); return; }
      giveaway.participants.add(interaction.user.id);
      await interaction.update({ embeds: [buildGiveawayEmbed(giveaway)] });
      return;
    }
  } catch (err) { console.error(err); }
});

client.on(Events.MessageCreate, async (message: Message) => {
  if (message.author.bot) return;
  const matchedPrefix = resolveMatchedPrefix(message.guildId, message.content);
  if (!matchedPrefix) {
    const aliasReply = getAliasReply(message.guildId, message.content);
    if (aliasReply) await message.reply(aliasReply);
    return;
  }

  const withoutPrefix = message.content.slice(matchedPrefix.length).trim();
  if (!withoutPrefix) return;
  const parts = withoutPrefix.split(/\s+/);
  const command = (parts.shift() || '').toLowerCase();
  const activePrefix = getPrimaryPrefix(message.guildId);

  if (command === 'help') { await message.reply(buildHelpText(activePrefix)); return; }
  if (command === 'ping') { await message.reply(`Pong! ${client.ws.ping}ms`); return; }
  if (command === 'purge' || command === 'clear') {
    const amount = parseInt(parts[0]);
    if (isNaN(amount) || amount < 1 || amount > 100) return;
    const result = await executePurge(message.channel, amount, {});
    const r = await message.channel.send(`Deleted **${result.deleted}** messages.`);
    setTimeout(() => r.delete().catch(() => null), 5000);
    return;
  }
  if (command === 'set_prefix_global_ds') {
    if (parts.length > 0) { DEFAULT_PREFIXES = parts; savePrefixStore(SETTINGS_FILE, prefixes); await message.reply('Done.'); }
    return;
  }
  // Simplified handling for other prefix commands can be added here
});

client.login(TOKEN).catch(console.error);