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

const DATA_DIR = path.join(process.cwd(), 'data');
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

// Render (and similar hosts) expect a Web Service to bind to .
if (PORT) {
  http
    .createServer((req, res) => {
      // Keep responses tiny; this is just for health checks / uptime.
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
    s: 1000,
    sec: 1000,
    second: 1000,
    seconds: 1000,
    m: 60 * 1000,
    min: 60 * 1000,
    minute: 60 * 1000,
    minutes: 60 * 1000,
    h: 60 * 60 * 1000,
    hr: 60 * 60 * 1000,
    hour: 60 * 60 * 1000,
    hours: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    day: 24 * 60 * 60 * 1000,
    days: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
    weeks: 7 * 24 * 60 * 60 * 1000,
    mon: 30 * 24 * 60 * 60 * 1000,
    month: 30 * 24 * 60 * 60 * 1000,
    months: 30 * 24 * 60 * 60 * 1000,
    y: 365 * 24 * 60 * 60 * 1000,
    year: 365 * 24 * 60 * 60 * 1000,
    years: 365 * 24 * 60 * 60 * 1000
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
    `${prefixValue}kick @user [reason]`,
    `${prefixValue}ban @user [reason]`,
    `${prefixValue}mute/@timeout @user <10min/30sec/2hour/1day/1week/1mon/1y> [reason]`,
    `${prefixValue}unmute/@untimeout @user [reason]`,
    '',
    'Slash:',
    '/uptime /botinfo /choose /roll /coinflip /8ball /reverse /calc /giveaway /role /prefix /avatar /userinfo /serverinfo /delete server /alias /aliasdel /aliases /tag /tagscript /say /embed /kick /ban /mute /timeout /unmute /untimeout'
  ].join('\n');
}

async function sendToChannel(
  channel: unknown,
  payload: string | { embeds?: EmbedBuilder[]; components?: unknown[]; content?: string }
): Promise<unknown | null> {
  if (channel && typeof (channel as { send?: unknown }).send === 'function') {
    return (channel as { send: (content: typeof payload) => Promise<unknown> }).send(payload);
  }
  return null;
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
    try {
      await targetUser.send(content);
    } catch {
      // Ignore DM failures (privacy settings / closed DMs).
    }
  };

  if (!botMember) {
    await reply('Bot member is not ready. Try again.');
    return;
  }

  if (targetUser.id === moderatorMember.id) {
    await reply('You cannot moderate yourself.');
    return;
  }

  if (targetUser.id === client.user?.id) {
    await reply('I cannot moderate myself.');
    return;
  }

  if (action === 'kick') {
    if (!moderatorMember.permissions.has(PermissionFlagsBits.KickMembers)) {
      await reply('You need `Kick Members` permission.');
      return;
    }
    if (!botMember.permissions.has(PermissionFlagsBits.KickMembers)) {
      await reply('I need `Kick Members` permission.');
      return;
    }
    if (!targetMember || !targetMember.kickable) {
      await reply('I cannot kick that user (not in server or role hierarchy issue).');
      return;
    }

    await targetMember.kick(safeReason);
    await sendDmNotice(
      [
        `You were kicked from **${guild.name}**.`,
        `By: **${moderatorMember.user.tag}**`,
        `Date: **${nowString} (IST)**`,
        `Reason: ${safeReason}`
      ].join('\n')
    );
    await reply(`Kicked **${targetUser.tag}**. Reason: ${safeReason}`);
    return;
  }

  if (action === 'ban') {
    if (!moderatorMember.permissions.has(PermissionFlagsBits.BanMembers)) {
      await reply('You need `Ban Members` permission.');
      return;
    }
    if (!botMember.permissions.has(PermissionFlagsBits.BanMembers)) {
      await reply('I need `Ban Members` permission.');
      return;
    }

    const deleteMessageSeconds = Math.max(0, Math.min(7, Number(deleteDays || 0))) * 86400;

    await guild.members.ban(targetUser.id, {
      reason: safeReason,
      deleteMessageSeconds
    });
    await sendDmNotice(
      [
        `You were banned from **${guild.name}**.`,
        `By: **${moderatorMember.user.tag}**`,
        `Date: **${nowString} (IST)**`,
        `Reason: ${safeReason}`
      ].join('\n')
    );
    await reply(`Banned **${targetUser.tag}**. Reason: ${safeReason}`);
    return;
  }

  if (action === 'timeout') {
    if (!moderatorMember.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      await reply('You need `Moderate Members` permission.');
      return;
    }
    if (!botMember.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      await reply('I need `Moderate Members` permission.');
      return;
    }
    if (!targetMember || !targetMember.moderatable || !timeoutMs) {
      await reply('I cannot timeout that user (not in server, duration missing, or hierarchy issue).');
      return;
    }

    await targetMember.timeout(timeoutMs, safeReason);
    const untilString = new Date(Date.now() + timeoutMs).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata'
    });
    await sendDmNotice(
      [
        `You were muted (timed out) in **${guild.name}**.`,
        `By: **${moderatorMember.user.tag}**`,
        `Duration: **${timeoutLabel || 'custom'}**`,
        `Until: **${untilString} (IST)**`,
        `Date: **${nowString} (IST)**`,
        `Reason: ${safeReason}`
      ].join('\n')
    );
    await reply(`Timed out **${targetUser.tag}** for **${timeoutLabel || 'custom'}**. Reason: ${safeReason}`);
    return;
  }

  if (action === 'untimeout') {
    if (!moderatorMember.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      await reply('You need `Moderate Members` permission.');
      return;
    }
    if (!botMember.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      await reply('I need `Moderate Members` permission.');
      return;
    }
    if (!targetMember || !targetMember.moderatable) {
      await reply('I cannot untimeout that user (not in server or hierarchy issue).');
      return;
    }

    await targetMember.timeout(null, safeReason);
    await reply(`Removed timeout from **${targetUser.tag}**. Reason: ${safeReason}`);
  }
}

function getGuildPrefixes(guildId?: string | null): string[] {
  if (!guildId) return DEFAULT_PREFIXES;
  const customPrefix = prefixes[guildId];
  if (customPrefix) {
    return [...new Set([customPrefix, ...DEFAULT_PREFIXES])];
  }
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
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${days}d ${hours}h ${minutes}m ${seconds}s`;
}

function chooseRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function safeCalculate(expression: string): number | null {
  const trimmed = expression.trim();
  if (!trimmed) return null;
  if (!/^[0-9+\-*/().\s]+$/.test(trimmed)) return null;

  try {
    const result = Function(`"use strict"; return (${trimmed});`)();
    if (typeof result !== 'number' || !Number.isFinite(result)) return null;
    return result;
  } catch {
    return null;
  }
}

function buildGiveawayEmbed(giveaway: GiveawayEntry): EmbedBuilder {
  const participantsCount = giveaway.participants.size;
  return new EmbedBuilder()
    .setTitle(`Giveaway: ${giveaway.title}`)
    .setDescription('Click **Participate!** below to join the giveaway.')
    .setColor(giveaway.ended ? 0x777777 : 0x00b894)
    .addFields(
      { name: 'Host', value: giveaway.hostName, inline: true },
      { name: 'Winners', value: String(giveaway.winnersCount), inline: true },
      { name: 'Participants', value: String(participantsCount), inline: true },
      { name: 'Ends', value: `<t:${Math.floor(giveaway.endAt / 1000)}:R>`, inline: false }
    )
    .setFooter({ text: giveaway.ended ? 'Giveaway ended' : 'Good luck!' });
}

function createGiveawayRow(disabled: boolean): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('giveaway_join')
      .setLabel('Participate!')
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled)
  );
}

function scheduleGiveawayEnd(giveawayId: string): void {
  const maxDelay = 2_147_000_000;
  const giveaway = giveaways.get(giveawayId);
  if (!giveaway || giveaway.ended) return;

  const remaining = giveaway.endAt - Date.now();
  if (remaining <= 0) {
    void endGiveaway(giveawayId);
    return;
  }

  if (remaining > maxDelay) {
    setTimeout(() => scheduleGiveawayEnd(giveawayId), maxDelay);
    return;
  }

  setTimeout(() => {
    void endGiveaway(giveawayId);
  }, remaining);
}

async function endGiveaway(giveawayId: string): Promise<void> {
  const giveaway = giveaways.get(giveawayId);
  if (!giveaway || giveaway.ended) return;
  giveaway.ended = true;

  const channel = await client.channels.fetch(giveaway.channelId).catch(() => null);
  if (!channel || !('messages' in channel)) return;

  const giveawayMessage = await (channel as any).messages.fetch(giveaway.messageId).catch(() => null);
  if (!giveawayMessage) return;

  const participants = [...giveaway.participants];
  const winners: string[] = [];
  const shuffled = [...participants].sort(() => Math.random() - 0.5);
  for (let index = 0; index < Math.min(giveaway.winnersCount, shuffled.length); index += 1) {
    winners.push(shuffled[index]);
  }

  const endedEmbed = buildGiveawayEmbed(giveaway).setColor(0x636e72);
  await giveawayMessage.edit({ embeds: [endedEmbed], components: [createGiveawayRow(true)] }).catch(() => null);

  if (winners.length === 0) {
    await sendToChannel(channel, `Giveaway ended for **${giveaway.title}**. No participants joined.`);
    return;
  }

  const mentionList = winners.map(userId => `<@${userId}>`).join(', ');
  await sendToChannel(channel, `Giveaway ended for **${giveaway.title}**.\nWinner(s): ${mentionList}`);
}

async function handleSlash(interaction: ChatInputCommandInteraction): Promise<void> {
  const name = interaction.commandName;

  if (name === 'ping') {
    await interaction.deferReply();
    await interaction.editReply(`Pong! ${client.ws.ping}ms`);
    return;
  }

  if (name === 'uptime') {
    await interaction.reply(`Uptime: **${getUptimeText()}**`);
    return;
  }

  if (name === 'help') {
    await interaction.reply({ content: buildHelpText(getPrimaryPrefix(interaction.guildId)), ephemeral: true });
    return;
  }

  if (name === 'guildid') {
    await interaction.reply({ content: `Guild ID: ${interaction.guildId || 'N/A'}`, ephemeral: true });
    return;
  }

  if (name === 'botinfo') {
    await interaction.reply(
      [
        `Bot: **${client.user?.tag || 'Unknown'}**`,
        `ID: \`${client.user?.id || 'N/A'}\``,
        `Servers: **${client.guilds.cache.size}**`,
        `Uptime: **${getUptimeText()}**`
      ].join('\n')
    );
    return;
  }

  if (name === 'choose') {
    const raw = interaction.options.getString('options', true);
    const options = raw
      .split(',')
      .map(option => option.trim())
      .filter(Boolean);
    if (options.length < 2) {
      await interaction.reply('Please provide at least 2 options separated by commas.');
      return;
    }
    await interaction.reply(`I choose: **${chooseRandom(options)}**`);
    return;
  }

  if (name === 'roll') {
    const sides = interaction.options.getInteger('sides') || 6;
    const value = Math.floor(Math.random() * sides) + 1;
    await interaction.reply(`Rolled d${sides}: **${value}**`);
    return;
  }

  if (name === 'coinflip') {
    await interaction.reply(`Coin: **${Math.random() < 0.5 ? 'Heads' : 'Tails'}**`);
    return;
  }

  if (name === '8ball') {
    const question = interaction.options.getString('question', true);
    const answers = [
      'Yes.',
      'No.',
      'Maybe.',
      'Definitely.',
      'Not likely.',
      'Ask again later.',
      'It is certain.',
      'Very doubtful.'
    ];
    await interaction.reply(`Question: ${question}\n8-Ball: **${chooseRandom(answers)}**`);
    return;
  }

  if (name === 'reverse') {
    const text = interaction.options.getString('text', true);
    await interaction.reply(text.split('').reverse().join(''));
    return;
  }

  if (name === 'calc') {
    const expression = interaction.options.getString('expression', true);
    const result = safeCalculate(expression);
    if (result === null) {
      await interaction.reply('Invalid expression. Use numbers and + - * / ( ) only.');
      return;
    }
    await interaction.reply(`Result: **${result}**`);
    return;
  }

  if (name === 'giveaway') {
    if (!interaction.guildId) {
      await interaction.reply({ content: 'Use this in a server.', ephemeral: true });
      return;
    }

    const channel = interaction.options.getChannel('channel', true);
    const modal = new ModalBuilder()
      .setCustomId(`giveaway_create:${channel.id}:${interaction.guildId}`)
      .setTitle('Create Giveaway');

    const durationInput = new TextInputBuilder()
      .setCustomId('duration')
      .setLabel('Duration (ex: 10min, 2hour, 1day)')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(20);

    const titleInput = new TextInputBuilder()
      .setCustomId('title')
      .setLabel('Title / Prize')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(100);

    const winnersInput = new TextInputBuilder()
      .setCustomId('winners')
      .setLabel('Winners Count')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(3)
      .setValue('1');

    const hostInput = new TextInputBuilder()
      .setCustomId('host')
      .setLabel('Host Name')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(40)
      .setValue(interaction.user.tag);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(durationInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(titleInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(winnersInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(hostInput)
    );

    await interaction.showModal(modal);
    return;
  }

  if (name === 'synccommands') {
    if (!interaction.guildId) {
      await interaction.reply({ content: 'Use this inside a server.', ephemeral: true });
      return;
    }
    await interaction.deferReply({ ephemeral: true });
    const result = await registerSlashCommands(interaction.guildId);
    await interaction.editReply(result.ok ? 'Commands synced for this server.' : 'Sync failed. Check invite scopes and permissions.');
    return;
  }

  if (name === 'prefix') {
    if (!interaction.guildId || !interaction.guild) {
      await interaction.reply({ content: 'Use this command in a server.', ephemeral: true });
      return;
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'add') {
      const value = interaction.options.getString('value', true).trim();
      if (!value || value.length > 5) {
        await interaction.reply({ content: 'Prefix must be 1-5 characters.', ephemeral: true });
        return;
      }

      prefixes[interaction.guildId] = value;
      savePrefixStore(SETTINGS_FILE, prefixes);
      await interaction.reply({ content: `Prefix updated for this server to \`${value}\`` });
      return;
    }

    if (sub === 'remove') {
      delete prefixes[interaction.guildId];
      savePrefixStore(SETTINGS_FILE, prefixes);
      await interaction.reply({
        content: `Prefix reset for this server. Now using global defaults: \`${DEFAULT_PREFIXES.join('`, `')}\``
      });
      return;
    }

    if (sub === 'list') {
      const current = getGuildPrefixes(interaction.guildId);
      const isDefault = !prefixes[interaction.guildId];
      await interaction.reply({
        content: [
          `Active prefix${current.length > 1 ? 'es' : ''} for this server: \`${current.join('`, `')}\``,
          isDefault ? '(Using global default prefixes)' : `(Custom prefix \`${prefixes[interaction.guildId]}\` is active)`
        ].join('\n')
      });
      return;
    }
  }

  if (name === 'say') {
    const text = interaction.options.getString('text', true);
    const channel = interaction.options.getChannel('channel');
    await interaction.reply({ content: 'Sent.', ephemeral: true });
    await sendToChannel(channel ?? interaction.channel, text);
    return;
  }

  if (name === 'avatar') {
    const user = interaction.options.getUser('user') || interaction.user;
    const avatarUrl = user.displayAvatarURL({ size: 1024 });
    await interaction.reply({ content: `Avatar of **${user.tag}**: ${avatarUrl}` });
    return;
  }

  if (name === 'userinfo') {
    const user = interaction.options.getUser('user') || interaction.user;
    const member = interaction.guild ? await interaction.guild.members.fetch(user.id).catch(() => null) : null;
    const created = user.createdAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    const joined = member?.joinedAt
      ? member.joinedAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
      : 'Unknown / not in this server';
    await interaction.reply(
      [
        `User: **${user.tag}**`,
        `ID: \`${user.id}\``,
        `Created: **${created} (IST)**`,
        `Joined: **${joined}**`
      ].join('\n')
    );
    return;
  }

  if (name === 'serverinfo') {
    if (!interaction.guild) {
      await interaction.reply({ content: 'Use this in a server.', ephemeral: true });
      return;
    }
    await interaction.reply(
      [
        `Server: **${interaction.guild.name}**`,
        `ID: \`${interaction.guild.id}\``,
        `Members: **${interaction.guild.memberCount}**`,
        `Created: **${interaction.guild.createdAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} (IST)**`
      ].join('\n')
    );
    return;
  }

  if (name === 'role') {
    if (!interaction.guild || !interaction.member || !(interaction.member instanceof GuildMember)) {
      await interaction.reply({ content: 'Use this in a server.' });
      return;
    }

    const moderator = interaction.member;
    const botMember = interaction.guild.members.me;
    if (!botMember) {
      await interaction.reply({ content: 'Bot is not ready. Try again.' });
      return;
    }

    if (!moderator.permissions.has(PermissionFlagsBits.ManageRoles)) {
      await interaction.reply({ content: 'You need Manage Roles permission.' });
      return;
    }
    if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
      await interaction.reply({ content: 'I need Manage Roles permission.' });
      return;
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'create') {
      const roleName = interaction.options.getString('name', true).trim();
      const role = await interaction.guild.roles.create({
        name: roleName,
        reason: `Created by ${interaction.user.tag}`
      });
      await interaction.reply({ content: `Role created: ${role}` });
      return;
    }

    if (sub === 'del') {
      const roleOption = interaction.options.getRole('role', true);
      const role = interaction.guild.roles.cache.get(roleOption.id);
      if (!role) {
        await interaction.reply({ content: 'That role cannot be managed by this command.' });
        return;
      }
      if (role.id === interaction.guild.id) {
        await interaction.reply({ content: 'Cannot delete @everyone role.' });
        return;
      }
      if (role.position >= botMember.roles.highest.position) {
        await interaction.reply({ content: 'I cannot delete that role due to role hierarchy.' });
        return;
      }
      await role.delete(`Deleted by ${interaction.user.tag}`);
      await interaction.reply({ content: `Role deleted: **${role.name}**` });
      return;
    }

    if (sub === 'ren') {
      const roleOption = interaction.options.getRole('role', true);
      const role = interaction.guild.roles.cache.get(roleOption.id);
      if (!role) {
        await interaction.reply({ content: 'That role cannot be managed by this command.' });
        return;
      }
      const newName = interaction.options.getString('name', true).trim();
      if (role.id === interaction.guild.id) {
        await interaction.reply({ content: 'Cannot rename @everyone role.' });
        return;
      }
      if (role.position >= botMember.roles.highest.position) {
        await interaction.reply({ content: 'I cannot rename that role due to role hierarchy.' });
        return;
      }
      await role.edit({ name: newName, reason: `Renamed by ${interaction.user.tag}` });
      await interaction.reply({ content: `Role renamed to **${newName}**` });
      return;
    }

    const user = interaction.options.getUser('user', true);
    const roleOption = interaction.options.getRole('role', true);
    const role = interaction.guild.roles.cache.get(roleOption.id);
    if (!role) {
      await interaction.reply({ content: 'That role cannot be managed by this command.' });
      return;
    }
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member) {
      await interaction.reply({ content: 'User is not in this server.' });
      return;
    }

    if (role.position >= botMember.roles.highest.position) {
      await interaction.reply({ content: 'I cannot manage that role due to role hierarchy.' });
      return;
    }

    if (sub === 'add') {
      await member.roles.add(role, `Role added by ${interaction.user.tag}`);
      await interaction.reply({ content: `Added ${role} to **${member.user.tag}**` });
      return;
    }

    if (sub === 'rem') {
      await member.roles.remove(role, `Role removed by ${interaction.user.tag}`);
      await interaction.reply({ content: `Removed ${role} from **${member.user.tag}**` });
      return;
    }
  }
  if (name === 'delete') {
    if (interaction.options.getSubcommand() === 'server') {
      await interaction.reply(FAKE_DELETE_MESSAGE);
      return;
    }
  }

  if (name === 'embed') {
    const title = interaction.options.getString('title', true);
    const description = interaction.options.getString('description', true);
    const color = interaction.options.getString('color') || undefined;
    const image = interaction.options.getString('image') || undefined;
    const thumbnail = interaction.options.getString('thumbnail') || undefined;
    const channel = interaction.options.getChannel('channel');

    if (!isValidHex(color)) {
      await interaction.reply({ content: 'Invalid color. Use hex like #2ecc71', ephemeral: true });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(description)
      .setColor(normalizeHex(color) ?? 0x2ecc71)
      .setFooter({ text: `By ${interaction.user.tag}` });

    if (image) embed.setImage(image);
    if (thumbnail) embed.setThumbnail(thumbnail);

    await interaction.reply({ content: 'Embed sent.', ephemeral: true });
    await sendToChannel(channel ?? interaction.channel, { embeds: [embed] });
    return;
  }

  if (name === 'tagscript') {
    if (!interaction.guildId) {
      await interaction.reply({ content: 'Use this in a server.', ephemeral: true });
      return;
    }
    const tagName = sanitizeKey(interaction.options.getString('name', true));
    const content = tags[interaction.guildId]?.[tagName];
    await interaction.reply({ content: content ? `**${tagName}**\n${content}` : `Tag not found: ${tagName}` });
    return;
  }

  if (name === 'alias') {
    if (!interaction.guildId) {
      await interaction.reply({ content: 'Use this in a server.', ephemeral: true });
      return;
    }
    const trigger = sanitizeKey(interaction.options.getString('trigger', true));
    const output = interaction.options.getString('output', true).trim();

    const bucket = ensureGuildBucket(aliases, interaction.guildId);
    bucket[trigger] = output;
    saveStore(ALIAS_FILE, aliases);
    await interaction.reply({ content: `Alias set: **${trigger}** -> ${output}`, ephemeral: true });
    return;
  }

  if (name === 'aliasdel') {
    if (!interaction.guildId) {
      await interaction.reply({ content: 'Use this in a server.', ephemeral: true });
      return;
    }
    const trigger = sanitizeKey(interaction.options.getString('trigger', true));
    const bucket = ensureGuildBucket(aliases, interaction.guildId);

    if (!bucket[trigger]) {
      await interaction.reply({ content: `Alias not found: ${trigger}`, ephemeral: true });
      return;
    }

    delete bucket[trigger];
    saveStore(ALIAS_FILE, aliases);
    await interaction.reply({ content: `Removed alias: **${trigger}**`, ephemeral: true });
    return;
  }

  if (name === 'aliases') {
    if (!interaction.guildId) {
      await interaction.reply({ content: 'Use this in a server.', ephemeral: true });
      return;
    }
    const keys = Object.keys(aliases[interaction.guildId] || {});
    await interaction.reply({
      content: keys.length ? `Aliases:\n${keys.map(k => `- ${k}`).join('\n')}` : 'No aliases yet.',
      ephemeral: true
    });
    return;
  }

  if (name === 'tag') {
    if (!interaction.guildId) {
      await interaction.reply({ content: 'Use this in a server.', ephemeral: true });
      return;
    }
    const guildTags = ensureGuildBucket(tags, interaction.guildId);
    const sub = interaction.options.getSubcommand();

    if (sub === 'create') {
      const tagName = sanitizeKey(interaction.options.getString('name', true));
      const existingContent = guildTags[tagName] || '';

      const modal = new ModalBuilder()
        .setCustomId(`tag_create:${interaction.guildId}:${tagName}`)
        .setTitle(`Create Tag: ${tagName}`);

      const contentInput = new TextInputBuilder()
        .setCustomId('content')
        .setLabel('Tag Content')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(1800)
        .setPlaceholder('Write the tag content here...');

      if (existingContent) {
        contentInput.setValue(existingContent.slice(0, 1800));
      }

      const row = new ActionRowBuilder<TextInputBuilder>().addComponents(contentInput);
      modal.addComponents(row);

      await interaction.showModal(modal);
      return;
    }

    if (sub === 'view') {
      const tagName = sanitizeKey(interaction.options.getString('name', true));
      const content = guildTags[tagName];
      await interaction.reply({ content: content ? `**${tagName}**\n${content}` : `Tag not found: ${tagName}` });
      return;
    }

    if (sub === 'list') {
      const names = Object.keys(guildTags);
      await interaction.reply({
        content: names.length ? `Tags:\n${names.map(n => `- ${n}`).join('\n')}` : 'No tags yet.',
        ephemeral: true
      });
      return;
    }

    if (sub === 'delete') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        await interaction.reply({ content: 'You need Manage Server permission.', ephemeral: true });
        return;
      }

      const tagName = sanitizeKey(interaction.options.getString('name', true));
      if (!guildTags[tagName]) {
        await interaction.reply({ content: `Tag not found: ${tagName}`, ephemeral: true });
        return;
      }

      delete guildTags[tagName];
      saveStore(TAG_FILE, tags);
      await interaction.reply({ content: `Deleted tag: **${tagName}**`, ephemeral: true });
      return;
    }
  }

  if (name === 'kick' || name === 'ban' || name === 'timeout' || name === 'mute' || name === 'untimeout' || name === 'unmute') {
    if (!interaction.guild || !interaction.guildId || !interaction.member || !(interaction.member instanceof GuildMember)) {
      await interaction.reply({ content: 'Use this in a server.', ephemeral: true });
      return;
    }

    const user = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason') || undefined;
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);

    if (name === 'kick') {
      await runModerationAction({
        action: 'kick',
        moderatorMember: interaction.member,
        targetMember: member,
        targetUser: user,
        reason,
        reply: async msg => {
          await interaction.reply({ content: msg, ephemeral: true });
        }
      });
      return;
    }

    if (name === 'ban') {
      const deleteDays = interaction.options.getInteger('delete_days') || 0;
      await runModerationAction({
        action: 'ban',
        moderatorMember: interaction.member,
        targetMember: member,
        targetUser: user,
        reason,
        deleteDays,
        reply: async msg => {
          await interaction.reply({ content: msg, ephemeral: true });
        }
      });
      return;
    }

    if (name === 'timeout' || name === 'mute') {
      const minutes = interaction.options.getInteger('minutes', true);
      await runModerationAction({
        action: 'timeout',
        moderatorMember: interaction.member,
        targetMember: member,
        targetUser: user,
        reason,
        timeoutMs: minutes * 60 * 1000,
        timeoutLabel: `${minutes}min`,
        reply: async msg => {
          await interaction.reply({ content: msg, ephemeral: true });
        }
      });
      return;
    }

    await runModerationAction({
      action: 'untimeout',
      moderatorMember: interaction.member,
      targetMember: member,
      targetUser: user,
      reason,
      reply: async msg => {
        await interaction.reply({ content: msg, ephemeral: true });
      }
    });
    return;
  }
}

client.once(Events.ClientReady, async readyClient => {
  console.log(`Dhaniya Sir is online as ${readyClient.user.tag}!`);
  await registerSlashCommands();
});

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      await handleSlash(interaction);
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('tag_create:')) {
      const [, guildId, rawTagName] = interaction.customId.split(':');
      const tagName = sanitizeKey(rawTagName || '');
      const content = interaction.fields.getTextInputValue('content').trim();

      if (!guildId || !tagName || !content) {
        await interaction.reply({ content: 'Tag name/content missing.', ephemeral: true });
        return;
      }

      const guildTags = ensureGuildBucket(tags, guildId);
      guildTags[tagName] = content;
      saveStore(TAG_FILE, tags);
      await interaction.reply({ content: `Tag created: **${tagName}**`, ephemeral: true });
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('giveaway_create:')) {
      const [, channelId, guildId] = interaction.customId.split(':');
      if (!channelId || !guildId || !interaction.guildId || interaction.guildId !== guildId) {
        await interaction.reply({ content: 'Invalid giveaway context.', ephemeral: true });
        return;
      }

      const durationRaw = interaction.fields.getTextInputValue('duration').trim();
      const title = interaction.fields.getTextInputValue('title').trim();
      const winnersRaw = interaction.fields.getTextInputValue('winners').trim();
      const hostName = interaction.fields.getTextInputValue('host').trim();

      const parsedDuration = parseDurationToken(durationRaw);
      if (!parsedDuration.ok) {
        await interaction.reply({
          content: 'Invalid duration. Example: 10min, 2hour, 1day, 1week.',
          ephemeral: true
        });
        return;
      }

      const winnersCount = Number(winnersRaw);
      if (!Number.isInteger(winnersCount) || winnersCount < 1 || winnersCount > 20) {
        await interaction.reply({
          content: 'Winners count must be a whole number between 1 and 20.',
          ephemeral: true
        });
        return;
      }

      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (!channel) {
        await interaction.reply({ content: 'Could not find target channel.', ephemeral: true });
        return;
      }

      const giveaway: GiveawayEntry = {
        messageId: '',
        guildId,
        channelId,
        title,
        hostName,
        winnersCount,
        endAt: Date.now() + parsedDuration.ms,
        participants: new Set<string>(),
        ended: false
      };

      const sent = await sendToChannel(channel, {
        embeds: [buildGiveawayEmbed(giveaway)],
        components: [createGiveawayRow(false)]
      } as any);

      const messageId = (sent as any)?.id as string | undefined;
      if (!messageId) {
        await interaction.reply({ content: 'Failed to create giveaway message.', ephemeral: true });
        return;
      }

      giveaway.messageId = messageId;
      giveaways.set(messageId, giveaway);
      scheduleGiveawayEnd(messageId);

      await interaction.reply({ content: `Giveaway created in <#${channelId}>.`, ephemeral: true });
      return;
    }

    if (interaction.isButton() && interaction.customId === 'giveaway_join') {
      if (!interaction.message?.id) return;
      const giveaway = giveaways.get(interaction.message.id);
      if (!giveaway || giveaway.ended) {
        await interaction.reply({ content: 'This giveaway is no longer active.', ephemeral: true });
        return;
      }

      if (!interaction.guildId || interaction.guildId !== giveaway.guildId) {
        await interaction.reply({ content: 'Invalid giveaway context.', ephemeral: true });
        return;
      }

      if (giveaway.participants.has(interaction.user.id)) {
        await interaction.reply({ content: 'You already joined this giveaway.', ephemeral: true });
        return;
      }

      giveaway.participants.add(interaction.user.id);

      const updatedEmbed = buildGiveawayEmbed(giveaway);
      await interaction.update({ embeds: [updatedEmbed], components: [createGiveawayRow(false)] });
      return;
    }
  } catch (error) {
    console.error('Interaction error:', error);
    if (interaction.isRepliable()) {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: 'Something went wrong.', ephemeral: true });
      } else {
        await interaction.reply({ content: 'Something went wrong.', ephemeral: true });
      }
    }
  }
});

client.on(Events.MessageCreate, async (message: Message) => {
  if (message.author.bot) return;
  const matchedPrefix = resolveMatchedPrefix(message.guildId, message.content);
  const activePrefix = getPrimaryPrefix(message.guildId);

  if (!matchedPrefix) {
    const aliasReply = getAliasReply(message.guildId, message.content);
    if (aliasReply) {
      await message.reply(aliasReply);
      return;
    }

    if (message.content.trim().toLowerCase() === 'hi') {
      await message.reply('Hello beta');
    }
    return;
  }

  const withoutPrefix = message.content.slice(matchedPrefix.length).trim();
  if (!withoutPrefix) return;

  const parts = withoutPrefix.split(/\s+/);
  const command = (parts.shift() || '').toLowerCase();

  if (command === 'help') {
    await message.reply(buildHelpText(activePrefix));
    return;
  }

  if (command === 'ping') {
    await message.reply(`Pong! ${client.ws.ping}ms`);
    return;
  }

  if (command === 'uptime') {
    await message.reply(`Uptime: **${getUptimeText()}**`);
    return;
  }

  if (command === 'botinfo') {
    await message.reply(
      [
        `Bot: **${client.user?.tag || 'Unknown'}**`,
        `ID: \`${client.user?.id || 'N/A'}\``,
        `Servers: **${client.guilds.cache.size}**`,
        `Uptime: **${getUptimeText()}**`
      ].join('\n')
    );
    return;
  }

  if (command === 'choose') {
    const raw = withoutPrefix.slice(command.length).trim();
    const options = raw
      .split('|')
      .map(option => option.trim())
      .filter(Boolean);
    if (options.length < 2) {
      await message.reply(`Usage: ${activePrefix}choose <option1 | option2 | option3>`);
      return;
    }
    await message.reply(`I choose: **${chooseRandom(options)}**`);
    return;
  }

  if (command === 'roll') {
    const sides = Number(parts[0] || 6);
    if (!Number.isInteger(sides) || sides < 2 || sides > 1000) {
      await message.reply(`Usage: ${activePrefix}roll [sides between 2 and 1000]`);
      return;
    }
    const value = Math.floor(Math.random() * sides) + 1;
    await message.reply(`Rolled d${sides}: **${value}**`);
    return;
  }

  if (command === 'coinflip') {
    await message.reply(`Coin: **${Math.random() < 0.5 ? 'Heads' : 'Tails'}**`);
    return;
  }

  if (command === '8ball') {
    const question = withoutPrefix.slice(command.length).trim();
    if (!question) {
      await message.reply(`Usage: ${activePrefix}8ball <question>`);
      return;
    }
    const answers = [
      'Yes.',
      'No.',
      'Maybe.',
      'Definitely.',
      'Not likely.',
      'Ask again later.',
      'It is certain.',
      'Very doubtful.'
    ];
    await message.reply(`Question: ${question}\n8-Ball: **${chooseRandom(answers)}**`);
    return;
  }

  if (command === 'reverse') {
    const text = withoutPrefix.slice(command.length).trim();
    if (!text) {
      await message.reply(`Usage: ${activePrefix}reverse <text>`);
      return;
    }
    await message.reply(text.split('').reverse().join(''));
    return;
  }

  if (command === 'calc') {
    const expression = withoutPrefix.slice(command.length).trim();
    const result = safeCalculate(expression);
    if (result === null) {
      await message.reply('Invalid expression. Use numbers and + - * / ( ) only.');
      return;
    }
    await message.reply(`Result: **${result}**`);
    return;
  }

  if (command === 'prefix') {
    if (!message.guild || !message.member) {
      await message.reply('Use this command in a server.');
      return;
    }
    if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
      await message.reply('You need Manage Server permission.');
      return;
    }

    const sub = (parts[0] || '').toLowerCase();

    if (sub === 'add') {
      const newPrefix = (parts[1] || '').trim();
      if (!newPrefix || newPrefix.length > 5) {
        await message.reply(`Usage: ${activePrefix}prefix add <newprefix (1-5 chars)>`);
        return;
      }
      prefixes[message.guild.id] = newPrefix;
      savePrefixStore(SETTINGS_FILE, prefixes);
      await message.reply(`Prefix updated for this server to \`${newPrefix}\``);
      return;
    }

    if (sub === 'remove') {
      delete prefixes[message.guild.id];
      savePrefixStore(SETTINGS_FILE, prefixes);
      await message.reply(
        `Prefix reset for this server. Now using global defaults: \`${DEFAULT_PREFIXES.join('`, `')}\``
      );
      return;
    }

    if (sub === 'list') {
      const current = getGuildPrefixes(message.guild.id);
      const isDefault = !prefixes[message.guild.id];
      await message.reply(
        [
          `Active prefix${current.length > 1 ? 'es' : ''} for this server: \`${current.join('`, `')}\``,
          isDefault ? '(Using global default prefixes)' : `(Custom prefix \`${prefixes[message.guild.id]}\` is active)`
        ].join('\n')
      );
      return;
    }

    await message.reply(
      `Usage: ${activePrefix}prefix add <newprefix> | ${activePrefix}prefix remove | ${activePrefix}prefix list`
    );
    return;
  }

  if (command === 'dicebattle') {
    const targetUser = message.mentions.users.first();
    if (!targetUser || targetUser.bot || targetUser.id === message.author.id) {
      await message.reply(`Usage: ${activePrefix}dicebattle @user`);
      return;
    }
    const you = Math.floor(Math.random() * 6) + 1;
    const them = Math.floor(Math.random() * 6) + 1;
    const result =
      you === them
        ? 'Draw!'
        : you > them
          ? `${message.author} wins!`
          : `${targetUser} wins!`;
    await message.reply(`Dice Battle: ${message.author} rolled **${you}**, ${targetUser} rolled **${them}**.\n${result}`);
    return;
  }

  if (command === 'coinbattle') {
    const targetUser = message.mentions.users.first();
    if (!targetUser || targetUser.bot || targetUser.id === message.author.id) {
      await message.reply(`Usage: ${activePrefix}coinbattle @user`);
      return;
    }
    const yours = Math.random() < 0.5 ? 'Heads' : 'Tails';
    const theirs = Math.random() < 0.5 ? 'Heads' : 'Tails';
    const result = yours === theirs ? 'Draw!' : `${message.author} wins!`;
    await message.reply(
      `Coin Battle: ${message.author} got **${yours}**, ${targetUser} got **${theirs}**.\n${result}`
    );
    return;
  }

  if (command === 'shadow') {
    await message.reply('The shadows whisper: you found a hidden command.');
    return;
  }

  if (command === 'vault') {
    await message.reply('Vault opened: Courage + Consistency = unstoppable.');
    return;
  }

  if (command === 'guildid') {
    await message.reply(message.guild ? `Guild ID: ${message.guild.id}` : 'Use this in a server.');
    return;
  }

  if (command === 'synccommands') {
    if (!message.guild) {
      await message.reply('Use this in a server.');
      return;
    }
    if (!message.member?.permissions.has(PermissionFlagsBits.Administrator)) {
      await message.reply('You need Administrator permission.');
      return;
    }

    const ok = await registerSlashCommands(message.guild.id);
    await message.reply(ok.ok ? 'Commands synced.' : 'Command sync failed.');
    return;
  }

  if (command === 'set_prefix_global_ds') {
    const newPrefixes = parts;
    if (newPrefixes.length === 0) {
      await message.reply(`Current global prefixes: \`${DEFAULT_PREFIXES.join('`, `')}\`\nUsage: ${activePrefix}${command} <prefix1> [prefix2]...`);
      return;
    }
    if (newPrefixes.some(p => p.length > 5)) {
      await message.reply('Each prefix must be 1-5 characters long.');
      return;
    }

    DEFAULT_PREFIXES = newPrefixes;
    savePrefixStore(SETTINGS_FILE, prefixes);
    await message.reply(`Global prefixes updated to: \`${DEFAULT_PREFIXES.join('`, `')}\``);
    return;
  }

  if (command === 'role') {
    if (!message.guild || !message.member) {
      await message.reply('Use this command in a server.');
      return;
    }

    if (!message.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
      await message.reply('You need Manage Roles permission.');
      return;
    }

    const botMember = message.guild.members.me;
    if (!botMember || !botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
      await message.reply('I need Manage Roles permission.');
      return;
    }

    const sub = (parts.shift() || '').toLowerCase();
    const targetUser = message.mentions.users.first();
    const targetRole = message.mentions.roles.first();

    if (sub === 'create') {
      const roleName = parts.join(' ').trim();
      if (!roleName) {
        await message.reply(`Usage: ${activePrefix}role create <Role Name>`);
        return;
      }
      const role = await message.guild.roles.create({ name: roleName, reason: `Created by ${message.author.tag}` });
      await message.reply(`Role created: ${role}`);
      return;
    }

    if (sub === 'del') {
      if (!targetRole) {
        await message.reply(`Usage: ${activePrefix}role del @Role`);
        return;
      }
      if (targetRole.id === message.guild.id) {
        await message.reply('Cannot delete @everyone role.');
        return;
      }
      if (targetRole.position >= botMember.roles.highest.position) {
        await message.reply('I cannot delete that role due to role hierarchy.');
        return;
      }
      await targetRole.delete(`Deleted by ${message.author.tag}`);
      await message.reply(`Role deleted: **${targetRole.name}**`);
      return;
    }

    if (sub === 'ren') {
      if (!targetRole) {
        await message.reply(`Usage: ${activePrefix}role ren @Role name:<new name>`);
        return;
      }
      if (targetRole.id === message.guild.id) {
        await message.reply('Cannot rename @everyone role.');
        return;
      }
      if (targetRole.position >= botMember.roles.highest.position) {
        await message.reply('I cannot rename that role due to role hierarchy.');
        return;
      }
      const remArgs = parts.filter(part => !part.startsWith('<@&')).join(' ').trim();
      const nameMatch = remArgs.match(/^name:\s*(.+)$/i);
      const newName = nameMatch ? nameMatch[1].trim() : '';
      if (!newName) {
        await message.reply(`Usage: ${activePrefix}role ren @Role name:<new name>`);
        return;
      }
      await targetRole.edit({ name: newName, reason: `Renamed by ${message.author.tag}` });
      await message.reply(`Role renamed to **${newName}**`);
      return;
    }

    if (sub === 'add' || sub === 'rem') {
      if (!targetUser || !targetRole) {
        await message.reply(`Usage: ${activePrefix}role ${sub} @user @Role`);
        return;
      }
      const member = await message.guild.members.fetch(targetUser.id).catch(() => null);
      if (!member) {
        await message.reply('User is not in this server.');
        return;
      }
      if (targetRole.position >= botMember.roles.highest.position) {
        await message.reply('I cannot manage that role due to role hierarchy.');
        return;
      }

      if (sub === 'add') {
        await member.roles.add(targetRole, `Role added by ${message.author.tag}`);
        await message.reply(`Added ${targetRole} to **${member.user.tag}**`);
      } else {
        await member.roles.remove(targetRole, `Role removed by ${message.author.tag}`);
        await message.reply(`Removed ${targetRole} from **${member.user.tag}**`);
      }
      return;
    }

    await message.reply(
      `Usage: ${activePrefix}role add @user @Role | ${activePrefix}role rem @user @Role | ${activePrefix}role ren @Role name:<new name> | ${activePrefix}role create <name> | ${activePrefix}role del @Role`
    );
    return;
  }
  if (command === 'say') {
    if (!message.member?.permissions.has(PermissionFlagsBits.ManageMessages)) {
      await message.reply('You need Manage Messages permission.');
      return;
    }

    let targetChannel: unknown = message.channel;
    const mentionedChannelId = pickMentionedChannelFromToken(parts[0]);
    if (mentionedChannelId && message.guild) {
      targetChannel = message.guild.channels.cache.get(mentionedChannelId) ?? message.channel;
      parts.shift();
    }

    const text = parts.join(' ').trim();
    if (!text) {
      await message.reply(`Usage: ${activePrefix}say [#channel] <text>`);
      return;
    }

    await sendToChannel(targetChannel, text);
    return;
  }

  if (command === 'avatar') {
    const user = message.mentions.users.first() || message.author;
    await message.reply(`Avatar of **${user.tag}**: ${user.displayAvatarURL({ size: 1024 })}`);
    return;
  }

  if (command === 'userinfo') {
    const user = message.mentions.users.first() || message.author;
    const member = message.guild ? await message.guild.members.fetch(user.id).catch(() => null) : null;
    const created = user.createdAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    const joined = member?.joinedAt
      ? member.joinedAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
      : 'Unknown / not in this server';
    await message.reply(
      [
        `User: **${user.tag}**`,
        `ID: \`${user.id}\``,
        `Created: **${created} (IST)**`,
        `Joined: **${joined}**`
      ].join('\n')
    );
    return;
  }

  if (command === 'serverinfo') {
    if (!message.guild) {
      await message.reply('Use this in a server.');
      return;
    }
    await message.reply(
      [
        `Server: **${message.guild.name}**`,
        `ID: \`${message.guild.id}\``,
        `Members: **${message.guild.memberCount}**`,
        `Created: **${message.guild.createdAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} (IST)**`
      ].join('\n')
    );
    return;
  }

  if (command === 'delete' && (parts[0] || '').toLowerCase() === 'server') {
    await message.reply(FAKE_DELETE_MESSAGE);
    return;
  }

  if (command === 'embed') {
    if (!message.member?.permissions.has(PermissionFlagsBits.ManageMessages)) {
      await message.reply('You need Manage Messages permission.');
      return;
    }

    let targetChannel: unknown = message.channel;
    if (parts[0]) {
      const mentionedChannelId = pickMentionedChannelFromToken(parts[0]);
      if (mentionedChannelId && message.guild) {
        targetChannel = message.guild.channels.cache.get(mentionedChannelId) ?? message.channel;
      }
    }

    const withoutPrefixContent = withoutPrefix.slice(command.length).trim();
    const raw = withoutPrefixContent.replace(/^<#\d+>\s*/, '');
    const chunks = raw.split('|').map(c => c.trim()).filter(Boolean);

    if (chunks.length < 2) {
      await message.reply(
        `Usage: ${activePrefix}embed [#channel] |title|description|#hex(optional)|image_url(optional)|thumbnail_url(optional)`
      );
      return;
    }

    const [title, description, color, image, thumbnail] = chunks;
    if (!isValidHex(color)) {
      await message.reply('Invalid color. Use hex like #2ecc71');
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(description)
      .setColor(normalizeHex(color) ?? 0x2ecc71)
      .setFooter({ text: `By ${message.author.tag}` });

    if (image) embed.setImage(image);
    if (thumbnail) embed.setThumbnail(thumbnail);

    await sendToChannel(targetChannel, { embeds: [embed] });
    return;
  }

  if (command === 'alias') {
    if (!message.member?.permissions.has(PermissionFlagsBits.ManageGuild)) {
      await message.reply('You need Manage Server permission.');
      return;
    }

    const trigger = sanitizeKey(parts.shift() || '');
    const output = parts.join(' ').trim();

    if (!trigger || !output) {
      await message.reply(`Usage: ${activePrefix}alias <trigger> <output text>`);
      return;
    }

    if (!message.guild) {
      await message.reply('Use this in a server.');
      return;
    }
    const guildAliases = ensureGuildBucket(aliases, message.guild.id);
    guildAliases[trigger] = output;
    saveStore(ALIAS_FILE, aliases);
    await message.reply(`Alias set: **${trigger}** -> ${output}`);
    return;
  }

  if (command === 'unalias') {
    if (!message.member?.permissions.has(PermissionFlagsBits.ManageGuild)) {
      await message.reply('You need Manage Server permission.');
      return;
    }

    const trigger = sanitizeKey(parts.shift() || '');
    if (!trigger) {
      await message.reply(`Usage: ${activePrefix}unalias <trigger>`);
      return;
    }

    if (!message.guild) {
      await message.reply('Use this in a server.');
      return;
    }
    const guildAliases = ensureGuildBucket(aliases, message.guild.id);
    if (!guildAliases[trigger]) {
      await message.reply(`Alias not found: ${trigger}`);
      return;
    }

    delete guildAliases[trigger];
    saveStore(ALIAS_FILE, aliases);
    await message.reply(`Removed alias: **${trigger}**`);
    return;
  }

  if (command === 'aliases') {
    if (!message.guild) {
      await message.reply('Use this in a server.');
      return;
    }
    const keys = Object.keys(aliases[message.guild.id] || {});
    await message.reply(keys.length ? `Aliases:\n${keys.map(k => `- ${k}`).join('\n')}` : 'No aliases yet.');
    return;
  }

  if (command === 'tag') {
    const name = sanitizeKey(parts.shift() || '');
    if (!name) {
      await message.reply(`Usage: ${activePrefix}tag <name>`);
      return;
    }

    if (!message.guild) {
      await message.reply('Use this in a server.');
      return;
    }
    const content = tags[message.guild.id]?.[name];
    await message.reply(content ? `**${name}**\n${content}` : `Tag not found: ${name}`);
    return;
  }

  if (command === 'tagscript') {
    const name = sanitizeKey(parts.shift() || '');
    if (!name) {
      await message.reply(`Usage: ${activePrefix}tagscript <name>`);
      return;
    }

    if (!message.guild) {
      await message.reply('Use this in a server.');
      return;
    }
    const content = tags[message.guild.id]?.[name];
    await message.reply(content ? `**${name}**\n${content}` : `Tag not found: ${name}`);
    return;
  }

  if (command === 'tagcreate') {
    if (!message.member?.permissions.has(PermissionFlagsBits.ManageGuild)) {
      await message.reply('You need Manage Server permission.');
      return;
    }

    const name = sanitizeKey(parts.shift() || '');
    const content = parts.join(' ').trim();

    if (!name || !content) {
      await message.reply(`Usage: ${activePrefix}tagcreate <name> <content>`);
      return;
    }

    if (!message.guild) {
      await message.reply('Use this in a server.');
      return;
    }
    const guildTags = ensureGuildBucket(tags, message.guild.id);
    guildTags[name] = content;
    saveStore(TAG_FILE, tags);
    await message.reply(`Tag saved: **${name}**`);
    return;
  }

  if (command === 'tagdelete') {
    if (!message.member?.permissions.has(PermissionFlagsBits.ManageGuild)) {
      await message.reply('You need Manage Server permission.');
      return;
    }

    const name = sanitizeKey(parts.shift() || '');
    if (!name) {
      await message.reply(`Usage: ${activePrefix}tagdelete <name>`);
      return;
    }

    if (!message.guild) {
      await message.reply('Use this in a server.');
      return;
    }
    const guildTags = ensureGuildBucket(tags, message.guild.id);
    if (!guildTags[name]) {
      await message.reply(`Tag not found: ${name}`);
      return;
    }

    delete guildTags[name];
    saveStore(TAG_FILE, tags);
    await message.reply(`Deleted tag: **${name}**`);
    return;
  }

  if (command === 'tags') {
    if (!message.guild) {
      await message.reply('Use this in a server.');
      return;
    }
    const names = Object.keys(tags[message.guild.id] || {});
    await message.reply(names.length ? `Tags:\n${names.map(n => `- ${n}`).join('\n')}` : 'No tags yet.');
    return;
  }

  if (!message.guild || !message.member) {
    await message.reply('Moderation commands work only in servers.');
    return;
  }

  const targetMember = message.mentions.members?.first() || null;
  const targetUser = message.mentions.users.first();
  const argsNoMention = parts.filter(arg => !arg.startsWith('<@'));

  if (['kick', 'ban', 'timeout', 'mute', 'untimeout', 'unmute'].includes(command) && !targetUser) {
    await message.reply(`Mention a user. Example: ${activePrefix}${command} @user ...`);
    return;
  }

  if (!targetUser) return;

  if (command === 'kick') {
    const reason = argsNoMention.join(' ') || undefined;
    await runModerationAction({
      action: 'kick',
      moderatorMember: message.member,
      targetMember,
      targetUser,
      reason,
      reply: async text => {
        await message.reply(text);
      }
    });
    return;
  }

  if (command === 'ban') {
    const reason = argsNoMention.join(' ') || undefined;
    await runModerationAction({
      action: 'ban',
      moderatorMember: message.member,
      targetMember,
      targetUser,
      reason,
      deleteDays: 0,
      reply: async text => {
        await message.reply(text);
      }
    });
    return;
  }

  if (command === 'timeout' || command === 'mute') {
    const parsed = parseDurationToken(argsNoMention[0]);
    if (!parsed.ok) {
      if (parsed.error === 'too_long') {
        await message.reply('Discord timeout max is 28 days. Use shorter duration.');
      } else {
        await message.reply(
          `Usage: ${activePrefix}${command} @user <10min/30sec/2hour/1day/1week/1mon/1y> [reason]`
        );
      }
      return;
    }

    const reason = argsNoMention.slice(1).join(' ') || undefined;
    await runModerationAction({
      action: 'timeout',
      moderatorMember: message.member,
      targetMember,
      targetUser,
      reason,
      timeoutMs: parsed.ms,
      timeoutLabel: parsed.label,
      reply: async text => {
        await message.reply(text);
      }
    });
    return;
  }

  if (command === 'untimeout' || command === 'unmute') {
    const reason = argsNoMention.join(' ') || undefined;
    await runModerationAction({
      action: 'untimeout',
      moderatorMember: message.member,
      targetMember,
      targetUser,
      reason,
      reply: async text => {
        await message.reply(text);
      }
    });
  }
});

client.login(TOKEN as string);