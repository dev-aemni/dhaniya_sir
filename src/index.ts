import 'dotenv/config';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
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
  TextInputBuilder,
  TextInputStyle,
  User
} from 'discord.js';

// IMPORT OUR NEW FILE!
import { slashCommands } from './commands';

// --- ENVIRONMENT & CONSTANTS ---
const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const PORT = Number(process.env.PORT || 0);
const BOT_START_TIME = Date.now();
const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000;
const FAKE_DELETE_MESSAGE = 'Command Successful:! The Server will gonna Delete in few Hours.';

if (!TOKEN) throw new Error('Missing TOKEN in .env');

// --- DATA PATHS ---
const DATA_DIR = process.env.RENDER_DISK_MOUNT_PATH || path.join(process.cwd(), 'data');
const ALIAS_FILE = path.join(DATA_DIR, 'aliases.json');
const TAG_FILE = path.join(DATA_DIR, 'tags.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const AFK_FILE = path.join(DATA_DIR, 'afk.json');

// --- TYPES ---
type TextStore = Record<string, string>;
type GuildTextStore = Record<string, TextStore>;
type PrefixStore = Record<string, string>;
type AfkStore = Record<string, { reason: string; time: number }>;
type GiveawayEntry = { messageId: string; guildId: string; channelId: string; title: string; hostName: string; winnersCount: number; endAt: number; participants: Set<string>; ended: boolean; };

// --- DEFAULT SETTINGS ---
let DEFAULT_PREFIXES = ['> ', '>', 'ds-', "'", ':)'];
let GLOBAL_ALIASES: Record<string, string> = {
  "?ds": "Yes Sir! I am working! I am here!",
  "chal raha mera bot?": "Ha, bilkul",
  "soja ds": "Ok, bye! Good night! Badh mein ata hu!",
  "kuchi kuchi": "https://tenor.com/view/cute-cat-cute-kuchi-k-kuchi-puchi-kuchi-gif-4714708621124139871",
  "bhoot": "░░░░░░░░░░░░░░░░░░░░\n░░░░░▐▀█▀▌░░░░▀█▄░░░ \n░░░░░▐█▄█▌░░░░░░▀█▄░░ \n░░░░░░▀▄▀░░░▄▄▄▄▄▀▀░░ \n░░░░▄▄▄██▀▀▀▀░░░░░░░ \n░░░█▀▄▄▄█░▀▀░░ \n░░░▌░▄▄▄▐▌▀▀▀░░ \n▄░▐░░░▄▄░█░▀▀ ░░ \n▀█▌░░░▄░▀█▀░▀ ░░ \n░░░░░░░▄▄▐▌▄▄░░░ \n░░░░░░░▀███▀█░▄░░ \n░░░░░░▐▌▀▄▀▄▀▐▄░░ \n░░░░░░▐▀░░░░░░▐▌░░ \n░░░░░░█░░░░░░░░█░░░░░░░\n░░░░░░█░░░░░░░░█░░░░░░░\n░░░░░░█░░░░░░░░█░░░░░░░\n░░░░▄██▄░░░░░▄██▄░░░",
  "gm ds": "Good Morning Sir!",
  "i love you ds": "I love you too ! muummaa"
};

// --- STORAGE LOGIC ---
function ensureStore(filePath: string): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, '{}', 'utf8');
}

function loadGuildTextStore(filePath: string): GuildTextStore {
  ensureStore(filePath);
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed !== 'object' || parsed === null) return {};
    const values = Object.values(parsed);
    if (values.length > 0 && values.every(value => typeof value === 'string')) return {};
    const result: GuildTextStore = {};
    for (const [guildId, bucket] of Object.entries(parsed)) {
      if (typeof bucket !== 'object' || bucket === null) continue;
      result[guildId] = {};
      for (const [key, value] of Object.entries(bucket as Record<string, unknown>)) {
        if (typeof value === 'string') result[guildId][key] = value;
      }
    }
    return result;
  } catch { return {}; }
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
        DEFAULT_PREFIXES = value.filter(p => typeof p === 'string' && p.trim());
      } else if (key === '_global_aliases' && typeof value === 'object' && value !== null) {
        GLOBAL_ALIASES = { ...GLOBAL_ALIASES, ...(value as Record<string, string>) };
      } else if (typeof value === 'string' && value.trim()) {
        result[key] = value.trim();
      }
    }
    return result;
  } catch { return {}; }
}

function loadAfkStore(filePath: string): AfkStore {
  ensureStore(filePath);
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')) as AfkStore; } catch { return {}; }
}

function saveStore(filePath: string, store: any): void { fs.writeFileSync(filePath, JSON.stringify(store, null, 2), 'utf8'); }
function savePrefixStore(filePath: string, store: PrefixStore): void {
  fs.writeFileSync(filePath, JSON.stringify({ ...store, _global_prefixes: DEFAULT_PREFIXES, _global_aliases: GLOBAL_ALIASES }, null, 2), 'utf8');
}
function ensureGuildBucket(store: GuildTextStore, guildId: string): TextStore {
  if (!store[guildId]) store[guildId] = {};
  return store[guildId];
}

const aliases = loadGuildTextStore(ALIAS_FILE);
const tags = loadGuildTextStore(TAG_FILE);
const prefixes = loadPrefixStore(SETTINGS_FILE);
const afks = loadAfkStore(AFK_FILE);
const giveaways = new Map<string, GiveawayEntry>();

// Global active embed builders storage
const activeEmbedBuilders = new Map<string, { embed: EmbedBuilder, buttons: ButtonBuilder[], botMsg: Message, awaiting: string | null, editTarget?: Message }>();

// --- CLIENT SETUP ---
const client = new Client({ intents: [ GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMembers, GatewayIntentBits.MessageContent ] });

if (PORT) {
  http.createServer((req, res) => {
    if (req.url === '/healthz') { res.writeHead(200); res.end('ok'); return; }
    res.writeHead(200); res.end('Dhaniya Sir is running');
  }).listen(PORT, '0.0.0.0');
}

// --- UTILS AND HELPERS ---
function sanitizeKey(raw: string): string { return raw.trim().toLowerCase(); }

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

function getUptimeText(): string {
  const totalSeconds = Math.floor((Date.now() - BOT_START_TIME) / 1000);
  const d = Math.floor(totalSeconds / 86400);
  const h = Math.floor((totalSeconds % 86400) / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${d}d ${h}h ${m}m ${s}s`;
}

async function registerSlashCommands(preferredGuildId?: string): Promise<{ ok: boolean }> {
  if (!CLIENT_ID) return { ok: false };
  const rest = new REST({ version: '10' }).setToken(TOKEN as string);
  const guildIdToUse = preferredGuildId || GUILD_ID;
  if (guildIdToUse) {
    try {
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID, guildIdToUse), { body: slashCommands });
      await rest.put(Routes.applicationCommands(CLIENT_ID), { body: [] });
      return { ok: true };
    } catch { return { ok: false }; }
  }
  try {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: slashCommands });
    return { ok: true };
  } catch { return { ok: false }; }
}

function normalizeHex(color?: string): number | undefined {
  if (!color) return undefined;
  return Number.parseInt(color.trim().replace('#', ''), 16);
}

function parseDurationToken(token: string | undefined): { ok: true; ms: number; label: string } | { ok: false; error: 'invalid' | 'too_long' } {
  if (!token) return { ok: false, error: 'invalid' };
  const match = token.trim().toLowerCase().match(/^(\d+)([a-z]+)?$/);
  if (!match) return { ok: false, error: 'invalid' };
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: 'invalid' };
  const unit = match[2] || 'min';
  const unitMsMap: Record<string, number> = { s: 1000, sec: 1000, m: 60000, min: 60000, h: 3600000, hr: 3600000, d: 86400000, w: 604800000 };
  const ms = amount * (unitMsMap[unit[0]] || 60000);
  if (ms > MAX_TIMEOUT_MS) return { ok: false, error: 'too_long' };
  return { ok: true, ms, label: `${amount}${unit}` };
}

function buildHelpText(prefixValue: string = DEFAULT_PREFIXES[0]): string {
  return `Prefix: ${prefixValue}\nMain: help, ping, uptime, botinfo, choose, roll, coinflip, 8ball, reverse, calc, prefix, avatar, userinfo, serverinfo, purge, afk\nEmbeds: embed, embed edit [message_id]\nAliases: alias, unalias, aliases\nTags: tag, tagcreate, tagscript, tagdelete, tags\nModeration: kick, ban, timeout, mute, untimeout, unmute\nSlash: Use / to see all commands`;
}

async function sendToChannel(channel: any, payload: any): Promise<any | null> {
  if (channel && typeof channel.send === 'function') return channel.send(payload);
  return null;
}

// --- INTERACTIVE EMBED BUILDER ---
function getEmbedUIRows(builder: { buttons: ButtonBuilder[] }) {
  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('emb_title').setLabel('Title').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('emb_desc').setLabel('Description').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('emb_color').setLabel('Color').setStyle(ButtonStyle.Danger)
  );
  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('emb_img').setLabel('Image').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('emb_thumb').setLabel('Thumbnail').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('emb_json').setLabel('JSON').setStyle(ButtonStyle.Danger)
  );
  const row3 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('emb_addbtn').setLabel('Add Buttons').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('emb_save').setLabel('Save').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('emb_exit').setLabel('Exit').setStyle(ButtonStyle.Secondary)
  );

  const rows = [row1, row2, row3];
  if (builder.buttons.length > 0) {
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(builder.buttons));
  }
  return rows;
}

async function startEmbedBuilder(ctx: Message | ChatInputCommandInteraction, editMsgId?: string) {
  const authorId = 'user' in ctx ? ctx.user.id : ctx.author.id;
  let targetMessage: Message | undefined;

  if (editMsgId && ctx.channel && 'messages' in ctx.channel) {
    try { targetMessage = await (ctx.channel as any).messages.fetch(editMsgId); } 
    catch { 
      if ('reply' in ctx && typeof ctx.reply === 'function') await ctx.reply(ctx instanceof ChatInputCommandInteraction ? { content: "Target message not found.", ephemeral: true } : "Target message not found.");
      return;
    }
  }

  const embed = targetMessage && targetMessage.embeds[0] ? new EmbedBuilder(targetMessage.embeds[0].data) : new EmbedBuilder().setDescription('New Embed');
  const existingButtons: ButtonBuilder[] = [];
  
  if (targetMessage && targetMessage.components.length > 0) {
      targetMessage.components.forEach((row: any) => {
          row.components.forEach((comp: any) => {
              if (comp.type === 2 && comp.url) {
                  existingButtons.push(new ButtonBuilder().setLabel(comp.label || 'Link').setURL(comp.url).setStyle(ButtonStyle.Link));
              }
          });
      });
  }

  const content = "**DO THE UI LIKE THIS**\nUse the buttons below to add fields";
  const builderState = { embed, buttons: existingButtons, botMsg: null as any, awaiting: null, editTarget: targetMessage };
  
  let botMsg: Message;
  if (ctx instanceof ChatInputCommandInteraction) {
    botMsg = await ctx.reply({ content, embeds: [embed], components: getEmbedUIRows(builderState), fetchReply: true });
  } else {
    botMsg = await ctx.reply({ content, embeds: [embed], components: getEmbedUIRows(builderState) });
  }

  builderState.botMsg = botMsg;
  activeEmbedBuilders.set(authorId, builderState);
}

// --- PURGE AND MODERATION LOGIC ---
async function executePurge(channel: any, amount: number, filters: any): Promise<{ deleted: number; error?: string }> {
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
  } catch { return { deleted: 0, error: 'Failed to purge. Messages might be older than 14 days.' }; }
}

async function runModerationAction(params: any): Promise<void> {
  const { action, moderatorMember, targetMember, targetUser, reason, timeoutMs, timeoutLabel, deleteDays, reply } = params;
  const guild = moderatorMember.guild;
  const botMember = guild.members.me;
  const safeReason = reason || `No reason provided`;
  if (!botMember) return void reply('Bot not ready.');
  if (targetUser.id === moderatorMember.id || targetUser.id === client.user?.id) return void reply('Cannot moderate self.');

  if (action === 'kick') {
    if (!targetMember?.kickable) return void reply('Cannot kick that user.');
    await targetMember.kick(safeReason);
    return void reply(`Kicked **${targetUser.tag}**`);
  }
  if (action === 'ban') {
    await guild.members.ban(targetUser.id, { reason: safeReason, deleteMessageSeconds: (deleteDays || 0) * 86400 });
    return void reply(`Banned **${targetUser.tag}**`);
  }
  if (action === 'timeout') {
    if (!targetMember?.moderatable || !timeoutMs) return void reply('Cannot timeout that user.');
    await targetMember.timeout(timeoutMs, safeReason);
    return void reply(`Timed out **${targetUser.tag}** for **${timeoutLabel}**`);
  }
  if (action === 'untimeout') {
    if (!targetMember?.moderatable) return void reply('Cannot untimeout.');
    await targetMember.timeout(null, safeReason);
    return void reply(`Removed timeout from **${targetUser.tag}**`);
  }
}

function getGuildPrefixes(guildId?: string | null): string[] { return guildId && prefixes[guildId] ? [...new Set([prefixes[guildId], ...DEFAULT_PREFIXES])] : DEFAULT_PREFIXES; }
function getPrimaryPrefix(guildId?: string | null): string { return getGuildPrefixes(guildId)[0]; }
function resolveMatchedPrefix(guildId: string | null | undefined, content: string): string | null { return [...getGuildPrefixes(guildId)].sort((a, b) => b.length - a.length).find(p => content.startsWith(p)) || null; }

function getAliasReply(guildId: string | null | undefined, input: string): string | null {
  const key = input.trim().toLowerCase();
  if (guildId && aliases[guildId] && aliases[guildId][key]) return aliases[guildId][key];
  if (GLOBAL_ALIASES[key]) return GLOBAL_ALIASES[key];
  return null;
}

// --- GIVEAWAY HELPERS ---
function buildGiveawayEmbed(g: GiveawayEntry) {
  return new EmbedBuilder().setTitle(`Giveaway: ${g.title}`).setDescription('Click **Participate!** below to join.').setColor(g.ended ? 0x777777 : 0x00b894)
    .addFields({ name: 'Host', value: g.hostName, inline: true }, { name: 'Winners', value: String(g.winnersCount), inline: true }, { name: 'Participants', value: String(g.participants.size), inline: true }, { name: 'Ends', value: `<t:${Math.floor(g.endAt / 1000)}:R>`, inline: false }).setFooter({ text: g.ended ? 'Giveaway ended' : 'Good luck!' });
}
function createGiveawayRow(disabled: boolean) { return new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId('giveaway_join').setLabel('Participate!').setStyle(ButtonStyle.Success).setDisabled(disabled)); }
function scheduleGiveawayEnd(id: string) {
  const g = giveaways.get(id); if (!g || g.ended) return;
  const rem = g.endAt - Date.now(); if (rem <= 0) return void endGiveaway(id);
  setTimeout(() => { void endGiveaway(id); }, Math.min(rem, 2147483647));
}
async function endGiveaway(id: string) {
  const g = giveaways.get(id); if (!g || g.ended) return;
  g.ended = true;
  const channel = await client.channels.fetch(g.channelId).catch(() => null) as any; if (!channel) return;
  const msg = await channel.messages.fetch(g.messageId).catch(() => null); if (!msg) return;
  const winners = [...g.participants].sort(() => Math.random() - 0.5).slice(0, g.winnersCount);
  await msg.edit({ embeds: [buildGiveawayEmbed(g).setColor(0x636e72)], components: [createGiveawayRow(true)] }).catch(() => null);
  await channel.send(winners.length === 0 ? `Giveaway ended for **${g.title}**. No participants.` : `Giveaway ended for **${g.title}**.\nWinner(s): ${winners.map(u => `<@${u}>`).join(', ')}`);
}

// --- SLASH COMMAND HANDLER ---
async function handleSlash(interaction: ChatInputCommandInteraction): Promise<void> {
  const name = interaction.commandName;

  if (name === 'ping') return void interaction.reply(`Ping Pong Is **${client.ws.ping}ms~**`);
  if (name === 'uptime') return void interaction.reply(`Uptime: **${getUptimeText()}**`);
  if (name === 'help') return void interaction.reply({ content: buildHelpText(getPrimaryPrefix(interaction.guildId)), ephemeral: true });
  if (name === 'botinfo') return void interaction.reply([`Bot: **${client.user?.tag || 'Unknown'}**`, `ID: \`${client.user?.id || 'N/A'}\``, `Servers: **${client.guilds.cache.size}**`, `Uptime: **${getUptimeText()}**`].join('\n'));
  
  if (name === 'afk') {
    const reason = interaction.options.getString('reason') || 'AFK';
    afks[interaction.user.id] = { reason, time: Date.now() }; saveStore(AFK_FILE, afks);
    return void interaction.reply({ content: `You are now AFK: **${reason}**`, ephemeral: true });
  }

  if (name === 'choose') {
    const options = interaction.options.getString('options', true).split(',').map(o => o.trim()).filter(Boolean);
    if (options.length < 2) return void interaction.reply('Provide at least 2 options separated by commas.');
    await interaction.reply(`I choose: **${chooseRandom(options)}**`);
    return;
  }

  if (name === 'roll') {
    const sides = interaction.options.getInteger('sides') || 6;
    await interaction.reply(`Rolled d${sides}: **${Math.floor(Math.random() * sides) + 1}**`);
    return;
  }

  if (name === 'coinflip') { await interaction.reply(`Coin: **${Math.random() < 0.5 ? 'Heads' : 'Tails'}**`); return; }

  if (name === '8ball') {
    const question = interaction.options.getString('question', true);
    const answers = ['Yes.', 'No.', 'Maybe.', 'Definitely.', 'Not likely.', 'Ask again later.', 'It is certain.', 'Very doubtful.'];
    await interaction.reply(`Question: ${question}\n8-Ball: **${chooseRandom(answers)}**`);
    return;
  }

  if (name === 'reverse') { await interaction.reply(interaction.options.getString('text', true).split('').reverse().join('')); return; }

  if (name === 'calc') {
    const res = safeCalculate(interaction.options.getString('expression', true));
    await interaction.reply(res !== null ? `Result: **${res}**` : 'Invalid expression.');
    return;
  }

  if (name === 'giveaway') {
    const channel = interaction.options.getChannel('channel', true);
    const modal = new ModalBuilder().setCustomId(`giveaway_create:${channel.id}:${interaction.guildId}`).setTitle('Create Giveaway');
    const dur = new TextInputBuilder().setCustomId('duration').setLabel('Duration (ex: 10min, 1day)').setStyle(TextInputStyle.Short).setRequired(true);
    const title = new TextInputBuilder().setCustomId('title').setLabel('Prize').setStyle(TextInputStyle.Short).setRequired(true);
    const win = new TextInputBuilder().setCustomId('winners').setLabel('Winners').setStyle(TextInputStyle.Short).setRequired(true).setValue('1');
    const host = new TextInputBuilder().setCustomId('host').setLabel('Host').setStyle(TextInputStyle.Short).setRequired(true).setValue(interaction.user.tag);
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(dur), new ActionRowBuilder<TextInputBuilder>().addComponents(title), new ActionRowBuilder<TextInputBuilder>().addComponents(win), new ActionRowBuilder<TextInputBuilder>().addComponents(host));
    await interaction.showModal(modal);
    return;
  }

  if (name === 'synccommands') {
    await interaction.deferReply({ ephemeral: true });
    const result = await registerSlashCommands(interaction.guildId || undefined);
    await interaction.editReply(result.ok ? 'Commands synced for this server.' : 'Sync failed. Check invite scopes and permissions.');
    return;
  }

  if (name === 'prefix') {
    if (!interaction.guildId) return;
    const sub = interaction.options.getSubcommand();
    if (sub === 'add') {
      const val = interaction.options.getString('value', true).trim();
      if (val.length > 5) return void interaction.reply({ content: 'Max 5 chars.', ephemeral: true });
      prefixes[interaction.guildId] = val; savePrefixStore(SETTINGS_FILE, prefixes);
      await interaction.reply(`Prefix set to \`${val}\``);
    } else if (sub === 'remove') {
      delete prefixes[interaction.guildId]; savePrefixStore(SETTINGS_FILE, prefixes);
      await interaction.reply('Prefix reset to global defaults.');
    } else {
      await interaction.reply(`Active prefixes: \`${getGuildPrefixes(interaction.guildId).join('`, `')}\``);
    }
    return;
  }

  if (name === 'say') {
    const channel = interaction.options.getChannel('channel') || interaction.channel;
    await interaction.reply({ content: 'Sent.', ephemeral: true });
    await sendToChannel(channel, interaction.options.getString('text', true));
    return;
  }

  if (name === 'avatar') {
    const user = interaction.options.getUser('user') || interaction.user;
    await interaction.reply(`Avatar of **${user.tag}**: ${user.displayAvatarURL({ size: 1024 })}`);
    return;
  }

  if (name === 'embed') {
    const msgId = interaction.options.getString('message_id') || undefined;
    await startEmbedBuilder(interaction, msgId);
    return;
  }

  if (name === 'purge') {
    const amount = interaction.options.getInteger('amount', true);
    const targetChannel = interaction.options.getChannel('channel') || interaction.channel;
    const regexStr = interaction.options.getString('regex');
    let regexPattern: RegExp | undefined;
    if (regexStr) {
      try { regexPattern = new RegExp(regexStr); } catch { return void interaction.reply({ content: 'Invalid Regex.', ephemeral: true }); }
    }

    await interaction.deferReply({ ephemeral: true });
    const res = await executePurge(targetChannel, amount, { userId: interaction.options.getUser('user')?.id, isBot: interaction.options.getString('filter') === 'bot', isHuman: interaction.options.getString('filter') === 'human', hasLink: interaction.options.getString('filter') === 'link', hasInvite: interaction.options.getString('filter') === 'invite', contain: interaction.options.getString('contain'), regex: regexPattern });
    return void interaction.editReply(res.error || `Successfully deleted **${res.deleted}** message(s).`);
  }

  if (name === 'role') {
    if (!interaction.guild || !(interaction.member instanceof GuildMember)) return;
    const botMember = interaction.guild.members.me;
    if (!botMember || !botMember.permissions.has(PermissionFlagsBits.ManageRoles)) return void interaction.reply('I need Manage Roles permission.');
    const sub = interaction.options.getSubcommand();
    
    if (sub === 'create') {
      const role = await interaction.guild.roles.create({ name: interaction.options.getString('name', true) });
      return void interaction.reply(`Role created: ${role}`);
    } else if (sub === 'del' || sub === 'ren' || sub === 'add' || sub === 'rem') {
      const roleOption = interaction.options.getRole('role', true);
      const role = interaction.guild.roles.cache.get(roleOption.id);
      if (!role || role.position >= botMember.roles.highest.position) return void interaction.reply('Cannot manage this role due to hierarchy.');
      
      if (sub === 'del') { await role.delete(); return void interaction.reply(`Deleted role.`); }
      if (sub === 'ren') { await role.edit({ name: interaction.options.getString('name', true) }); return void interaction.reply(`Renamed role.`); }
      
      const user = interaction.options.getUser('user', true);
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (!member) return void interaction.reply('User not found.');
      if (sub === 'add') { await member.roles.add(role); return void interaction.reply(`Added ${role} to ${member.user.tag}`); }
      if (sub === 'rem') { await member.roles.remove(role); return void interaction.reply(`Removed ${role} from ${member.user.tag}`); }
    }
  }

  if (['kick', 'ban', 'timeout', 'mute', 'untimeout', 'unmute'].includes(name)) {
    if (!interaction.guild || !(interaction.member instanceof GuildMember)) return;
    const user = interaction.options.getUser('user', true);
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    
    const params: any = {
      action: name === 'mute' ? 'timeout' : name === 'unmute' ? 'untimeout' : name,
      moderatorMember: interaction.member, targetMember: member, targetUser: user,
      reason: interaction.options.getString('reason') || undefined,
      reply: async (msg: string) => { await interaction.reply({ content: msg, ephemeral: true }); }
    };
    if (name === 'ban') params.deleteDays = interaction.options.getInteger('delete_days') || 0;
    if (name === 'timeout' || name === 'mute') {
      const mins = interaction.options.getInteger('minutes', true);
      params.timeoutMs = mins * 60000; params.timeoutLabel = `${mins}min`;
    }
    await runModerationAction(params);
  }
}

// --- EVENT HANDLERS ---
client.once(Events.ClientReady, async c => { console.log(`Online as ${c.user.tag}!`); await registerSlashCommands(); });

client.on(Events.InteractionCreate, async i => {
  try {
    if (i.isChatInputCommand()) return void handleSlash(i);

    // Embed Builder Button Handler
    if (i.isButton() && i.customId.startsWith('emb_')) {
      const builder = activeEmbedBuilders.get(i.user.id);
      if (!builder || builder.botMsg.id !== i.message.id) return void i.reply({ content: "This session has expired.", ephemeral: true });

      const action = i.customId.replace('emb_', '');
      
      if (action === 'save') {
        const finalComponents = builder.buttons.length > 0 ? [new ActionRowBuilder<ButtonBuilder>().addComponents(builder.buttons)] : [];
        if (builder.editTarget) {
          await builder.editTarget.edit({ embeds: [builder.embed], components: finalComponents as any }).catch(() => null);
          await i.reply({ content: "Embed edited successfully!", ephemeral: true });
        } else {
          await sendToChannel(i.channel, { embeds: [builder.embed], components: finalComponents });
          await i.reply({ content: "Embed sent successfully!", ephemeral: true });
        }
        await builder.botMsg.delete().catch(() => null);
        activeEmbedBuilders.delete(i.user.id);
        return;
      }
      
      if (action === 'exit') {
        await builder.botMsg.delete().catch(() => null);
        activeEmbedBuilders.delete(i.user.id);
        return void i.reply({ content: "Embed creation cancelled.", ephemeral: true });
      }

      builder.awaiting = action;
      if (action === 'addbtn') {
        return void i.reply({ content: "Give Button content link in chat. Format: `Label | https://link.com` (within 10 minutes)", ephemeral: true });
      }
      const prompts: Record<string, string> = { title: "title", desc: "description", color: "hex color (like #FF0000)", img: "image URL", thumb: "thumbnail URL", json: "raw JSON format" };
      return void i.reply({ content: `Enter ${prompts[action]} in the chat within next 10 minutes.`, ephemeral: true });
    }

    // Giveaway Modal Submit
    if (i.isModalSubmit() && i.customId.startsWith('giveaway_create:')) {
      const [, channelId, guildId] = i.customId.split(':');
      const parsed = parseDurationToken(i.fields.getTextInputValue('duration'));
      if (!parsed.ok) return void i.reply({ content: 'Invalid duration.', ephemeral: true });

      const channel = await client.channels.fetch(channelId!).catch(() => null);
      if (!channel) return void i.reply({ content: 'Channel not found.', ephemeral: true });

      const giveaway: GiveawayEntry = {
        messageId: '', guildId: guildId!, channelId: channelId!,
        title: i.fields.getTextInputValue('title'), hostName: i.fields.getTextInputValue('host'),
        winnersCount: Number(i.fields.getTextInputValue('winners')), endAt: Date.now() + parsed.ms,
        participants: new Set<string>(), ended: false
      };

      const sent = await sendToChannel(channel, { embeds: [buildGiveawayEmbed(giveaway)], components: [createGiveawayRow(false)] });
      if (!sent) return void i.reply({ content: 'Failed to send giveaway message.', ephemeral: true });

      giveaway.messageId = sent.id;
      giveaways.set(sent.id, giveaway);
      scheduleGiveawayEnd(sent.id);
      await i.reply({ content: `Giveaway created in <#${channelId}>.`, ephemeral: true });
    }

    // Giveaway Join Button
    if (i.isButton() && i.customId === 'giveaway_join') {
      const giveaway = giveaways.get(i.message.id);
      if (!giveaway || giveaway.ended) return void i.reply({ content: 'Giveaway inactive.', ephemeral: true });
      if (giveaway.participants.has(i.user.id)) return void i.reply({ content: 'Already joined.', ephemeral: true });
      giveaway.participants.add(i.user.id);
      await i.update({ embeds: [buildGiveawayEmbed(giveaway)] });
    }
  } catch (error) { console.error('Interaction error:', error); }
});

client.on(Events.MessageCreate, async (m: Message) => {
  if (m.author.bot) return;

  // AFK Logic - Welcome Back
  if (afks[m.author.id]) {
    delete afks[m.author.id]; saveStore(AFK_FILE, afks);
    const r = await m.reply(`Welcome back <@${m.author.id}>! I removed your AFK.`);
    setTimeout(() => r.delete().catch(() => null), 5000);
  }
  
  // AFK Logic - Mention Check
  if (m.mentions.users.size > 0) {
    m.mentions.users.forEach(u => { 
        if (afks[u.id]) m.reply(`**${u.tag}** is AFK right now! Reason: "**${afks[u.id].reason}**"`); 
    });
  }

  // Embed Builder Input Logic
  if (activeEmbedBuilders.has(m.author.id)) {
    const builder = activeEmbedBuilders.get(m.author.id)!;
    if (builder.awaiting) {
      let success = true;
      try {
        if (builder.awaiting === 'title') builder.embed.setTitle(m.content.slice(0, 256));
        else if (builder.awaiting === 'desc') builder.embed.setDescription(m.content.slice(0, 4096));
        else if (builder.awaiting === 'color') builder.embed.setColor(normalizeHex(m.content) || null);
        else if (builder.awaiting === 'img') builder.embed.setImage(m.content);
        else if (builder.awaiting === 'thumb') builder.embed.setThumbnail(m.content);
        else if (builder.awaiting === 'json') builder.embed = new EmbedBuilder(JSON.parse(m.content));
        else if (builder.awaiting === 'addbtn') {
          const parts = m.content.split('|').map(p => p.trim());
          if (parts.length < 2 || !parts[1].startsWith('http')) throw new Error('Invalid Link Format');
          builder.buttons.push(new ButtonBuilder().setLabel(parts[0]).setURL(parts[1]).setStyle(ButtonStyle.Link));
        }
      } catch {
        success = false;
        const err = await m.reply("Invalid input format!");
        setTimeout(() => err.delete().catch(() => null), 3000);
      }
      builder.awaiting = null;
      if (success) await builder.botMsg.edit({ embeds: [builder.embed], components: getEmbedUIRows(builder) }).catch(() => null);
      if (m.deletable) await m.delete().catch(() => null);
      return; 
    }
  }

  const prefix = resolveMatchedPrefix(m.guildId, m.content);
  if (!prefix) {
    const aliasReply = getAliasReply(m.guildId, m.content);
    if (aliasReply) await m.reply(aliasReply);
    return;
  }

  const args = m.content.slice(prefix.length).trim().split(/\s+/);
  const cmd = args.shift()?.toLowerCase();

  if (cmd === 'ping') return void m.reply(`Ping Pong Is **${client.ws.ping}ms~**`);
  if (cmd === 'uptime') return void m.reply(`Uptime: **${getUptimeText()}**`);
  if (cmd === 'botinfo') return void m.reply([`Bot: **${client.user?.tag}**`, `Servers: **${client.guilds.cache.size}**`, `Uptime: **${getUptimeText()}**`].join('\n'));
  if (cmd === 'help') return void m.reply(buildHelpText(getPrimaryPrefix(m.guildId)));

  if (cmd === 'afk') {
    const reason = args.join(' ') || 'AFK';
    afks[m.author.id] = { reason, time: Date.now() }; saveStore(AFK_FILE, afks);
    return void m.reply(`You are now AFK: **${reason}**`);
  }
  
  if (cmd === 'embed') {
    if (!m.member?.permissions.has(PermissionFlagsBits.ManageMessages)) return void m.reply('No permission.');
    let editId = args[0] === 'edit' ? args[1] : undefined;
    await startEmbedBuilder(m, editId);
    return;
  }

  if (cmd === 'purge' || cmd === 'clear') {
    if (!m.member?.permissions.has(PermissionFlagsBits.ManageMessages)) return;
    const amt = parseInt(args[0]); if (isNaN(amt)) return;
    
    let targetChannel: any = m.channel;
    let filterUser: string | undefined;
    let isBot = false, isHuman = false, hasLink = false, hasInvite = false, containStr: string | undefined, regexPattern: RegExp | undefined;

    let i = 1;
    while (i < args.length) {
      const p = args[i].toLowerCase();
      if (p === 'bot') isBot = true;
      else if (p === 'human') isHuman = true;
      else if (p === 'link') hasLink = true;
      else if (p === 'invite') hasInvite = true;
      else if (p === 'user') { i++; filterUser = args[i]?.replace(/[<@!>]/g, ''); }
      else if (p === 'channel') { i++; targetChannel = m.guild?.channels.cache.get(args[i]?.replace(/[<#>]/g, '')) || m.channel; }
      else if (p === 'contain') { containStr = args.slice(i + 1).join(' ').replace(/^"|"$/g, ''); break; }
      else if (p === 'regex') { try { regexPattern = new RegExp(args.slice(i + 1).join(' ').replace(/^"|"$/g, '')); } catch {} break; }
      else filterUser = args[i].replace(/[<@!>]/g, '');
      i++;
    }

    if (m.deletable) await m.delete().catch(() => null);
    const res = await executePurge(targetChannel, amt, { userId: filterUser, isBot, isHuman, hasLink, hasInvite, contain: containStr, regex: regexPattern });
    const replyMsg = await sendToChannel(m.channel, res.error || `Deleted **${res.deleted}** messages.`) as Message;
    if (replyMsg) setTimeout(() => replyMsg.delete().catch(() => null), 5000);
    return;
  }

  if (cmd === 'alias_global_set') {
    if (!m.member?.permissions.has(PermissionFlagsBits.Administrator)) return void m.reply('No permission.');
    const trigger = sanitizeKey(args.shift() || '');
    const output = args.join(' ').trim();
    if (!trigger || !output) return void m.reply(`Usage: ${prefix}alias_global_set <trigger> <output text>`);
    GLOBAL_ALIASES[trigger] = output; savePrefixStore(SETTINGS_FILE, prefixes);
    return void m.reply(`Global Alias set: **${trigger}**`);
  }

  if (cmd === 'alias_global_del') {
    if (!m.member?.permissions.has(PermissionFlagsBits.Administrator)) return void m.reply('No permission.');
    const trigger = sanitizeKey(args.shift() || '');
    if (!trigger || !GLOBAL_ALIASES[trigger]) return void m.reply(`Alias not found.`);
    delete GLOBAL_ALIASES[trigger]; savePrefixStore(SETTINGS_FILE, prefixes);
    return void m.reply(`Removed Global Alias: **${trigger}**`);
  }

  if (cmd === 'set_prefix_global_ds') {
    if (args.length > 0) {
      DEFAULT_PREFIXES = args; savePrefixStore(SETTINGS_FILE, prefixes);
      return void m.reply(`Global prefixes updated to: \`${DEFAULT_PREFIXES.join('`, `')}\``);
    }
  }
});

client.login(TOKEN);
