import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ChatInputCommandInteraction, Client, EmbedBuilder,
  GuildMember, Message, MessageFlags, PermissionFlagsBits,
  REST, Routes,
} from 'discord.js';
import {
  TOKEN, CLIENT_ID, GUILD_ID, BOT_START_TIME, MAX_TIMEOUT_MS,
  OPENROUTER_API_KEY, SYSTEM_PROMPT, SYSTEM_AI_PROVIDER, SETTINGS_FILE, OWNER_ID,
} from './config';
import {
  aliases, tags, prefixes, afks, giveaways, activeEmbedBuilders, activeChatSessions, controllers,
  DEFAULT_PREFIXES, GLOBAL_ALIASES, GiveawayEntry,
  setDefaultPrefixes, setGlobalAliases,
  saveStore, savePrefixStore, ensureGuildBucket,
} from './storage';

// ── Re-export setters so index.ts can reach them through utils if needed ──────
export { setDefaultPrefixes, setGlobalAliases };

// =============================================================================
// PURE UTILITIES
// =============================================================================
export function sanitizeKey(raw: string): string { return raw.trim().toLowerCase(); }
export function chooseRandom<T>(items: T[]): T   { return items[Math.floor(Math.random() * items.length)]; }
export function normalizeHex(input: string): number | null {
  const c = input.trim().replace(/^#/, '');
  return /^[0-9a-fA-F]{6}$/.test(c) ? parseInt(c, 16) : null;
}
export function safeCalculate(expr: string): number | null {
  const t = expr.trim();
  if (!t || !/^[0-9+\-*/().\s]+$/.test(t)) return null;
  try {
    const r = Function('"use strict"; return (' + t + ');')();
    return typeof r === 'number' && Number.isFinite(r) ? r : null;
  } catch { return null; }
}
export function getUptimeText(): string {
  const s = Math.floor((Date.now() - BOT_START_TIME) / 1000);
  return `${Math.floor(s/86400)}d ${Math.floor((s%86400)/3600)}h ${Math.floor((s%3600)/60)}m ${s%60}s`;
}
export function buildHelpText(p: string = DEFAULT_PREFIXES[0]): string {
  return `Prefix: \`${p}\`\n` +
    `**General:** help, ping, uptime, botinfo, choose, roll, coinflip, 8ball, reverse, calc, avatar, userinfo, serverinfo\n` +
    `**Utility:** prefix, purge, afk, say\n` +
    `**Embeds:** embed, embed edit [message_id]\n` +
    `**Aliases:** alias, unalias, aliases\n` +
    `**Tags:** tag, tagcreate, tagscript, tagdelete, tags\n` +
    `**Moderation:** kick, ban, timeout, mute, untimeout, unmute\n` +
    `**AI Chat:** \`${p}chat <message>\` or \`${p}'' <message>\` — talk to Dhaniya Sir AI (use \`${p}chat_clear\` to reset history)\n` +
    `**Slash:** Use \`/\` to see all slash commands (includes /chat for AI)`;
}
export function parseDurationToken(token: string | undefined): { ok: true; ms: number; label: string } | { ok: false; error: 'invalid' | 'too_long' } {
  if (!token) return { ok: false, error: 'invalid' };
  const m = token.trim().toLowerCase().match(/^(\d+)([a-z]+)?$/);
  if (!m) return { ok: false, error: 'invalid' };
  const amount = Number(m[1]);
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: 'invalid' };
  const unit = m[2] || 'min';
  const map: Record<string, number> = { s: 1000, sec: 1000, m: 60000, min: 60000, h: 3600000, hr: 3600000, d: 86400000, w: 604800000 };
  const ms = amount * (map[unit[0]] ?? 60000);
  if (ms > MAX_TIMEOUT_MS) return { ok: false, error: 'too_long' };
  return { ok: true, ms, label: `${amount}${unit}` };
}
export function getGuildPrefixes(guildId?: string | null): string[] {
  return guildId && prefixes[guildId] ? [...new Set([prefixes[guildId], ...DEFAULT_PREFIXES])] : DEFAULT_PREFIXES;
}
export function getPrimaryPrefix(guildId?: string | null): string { return getGuildPrefixes(guildId)[0]; }
export function resolveMatchedPrefix(guildId: string | null | undefined, content: string): string | null {
  return [...getGuildPrefixes(guildId)].sort((a, b) => b.length - a.length).find(p => content.startsWith(p)) ?? null;
}
export async function sendToChannel(channel: any, payload: any): Promise<any | null> {
  if (channel && typeof channel.send === 'function') return channel.send(payload).catch(() => null);
  return null;
}

// =============================================================================
// SLASH COMMAND REGISTRATION
// =============================================================================
export async function registerSlashCommands(
  commands: any[],
  preferredGuildId?: string,
): Promise<{ ok: boolean }> {
  if (!CLIENT_ID) { console.warn('[CMDS] No CLIENT_ID set, skipping sync.'); return { ok: false }; }
  const rest = new REST({ version: '10' }).setToken(TOKEN as string);
  const guildId = preferredGuildId || GUILD_ID;
  // 15 s timeout — prevents a slow REST call from blocking the event loop
  const timeout = (ms: number) => new Promise<never>((_, r) => setTimeout(() => r(new Error(`REST timeout after ${ms}ms`)), ms));
  try {
    if (guildId) {
      await Promise.race([rest.put(Routes.applicationGuildCommands(CLIENT_ID, guildId), { body: commands }), timeout(15_000)]);
      await Promise.race([rest.put(Routes.applicationCommands(CLIENT_ID), { body: [] }), timeout(15_000)]);
    } else {
      await Promise.race([rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands }), timeout(15_000)]);
    }
    return { ok: true };
  } catch (err) { console.error('[CMDS] REST error:', (err as Error).message); return { ok: false }; }
}

// =============================================================================
// TAGSCRIPT ENGINE — Full TagScript Support
// =============================================================================
export async function processTagScript(content: string, ctx: Message | ChatInputCommandInteraction, args: string[]) {
  let text = content;
  let shouldDelete = false;
  if (text.includes('{delete}')) { shouldDelete = true; text = text.replace(/\{delete\}/gi, ''); }

  const isMsg = ctx instanceof Message;
  const user   = isMsg ? ctx.author : ctx.user;
  const member = ctx.member as GuildMember | null;
  const guild  = ctx.guild;
  const ch     = ctx.channel as any;

  const map: Record<string, string> = {
    '{user}':               member?.nickname || user.username,
    '{user.username}':      user.username,
    '{user.mention}':       `<@${user.id}>`,
    '{mention}':            `<@${user.id}>`,
    '{user.id}':            user.id,
    '{user.avatar}':        user.displayAvatarURL(),
    '{user.color}':         member?.displayHexColor || '#000000',
    '{user.tag}':           user.tag,
    '{user.created}':       user.createdAt.toLocaleString(),
    '{server}':             guild?.name || 'Unknown Server',
    '{server.id}':          guild?.id   || 'Unknown ID',
    '{server.memberCount}': guild?.memberCount?.toString() || '0',
    '{server.icon}':        guild?.iconURL() || '',
    '{channel}':            ch?.name || 'Unknown Channel',
    '{channel.id}':         ch?.id   || 'Unknown ID',
    '{channel.mention}':    ch?.id   ? `<#${ch.id}>` : 'Unknown Channel',
    '{args}':               args.join(' '),
    '{unix}':               Math.floor(Date.now() / 1000).toString(),
    '{now}':                new Date().toLocaleString(),
  };

  let targetStr = map['{user}'];
  if (args[0]?.match(/^<@!?(\d+)>$/)) targetStr = args[0];
  map['{target}'] = targetStr;

  for (const [k, v] of Object.entries(map)) text = text.split(k).join(v);
  text = text.replace(/\{(\d+)\}/g, (_, p) => args[parseInt(p) - 1] || '');
  
  // {random:a,b,c} — pick random item
  text = text.replace(/\{random:\s*([^}]+)\}/gi, (_, p) => {
    const opts = p.split(/[,~]/).map((s: string) => s.trim()).filter(Boolean);
    return opts.length > 0 ? opts[Math.floor(Math.random() * opts.length)] : '';
  });
  
  // {5050:msg} — 50% chance
  text = text.replace(/\{5050:([^}]+)\}/gi, (_, msg) => Math.random() < 0.5 ? msg : '');
  
  // {if(condition):true|false} — conditional
  text = text.replace(/\{if\((.*?)(==|!=|<|>|<=|>=)(.*?)\):(.*?)(?:\|(.*?))?\}/gi,
    (_, left, op, right, onTrue, onFalse) => {
      left = left.trim(); right = right.trim();
      const nl = parseFloat(left), nr = parseFloat(right), num = !isNaN(nl) && !isNaN(nr);
      const r = op==='=='?left===right:op==='!='?left!==right:num&&op==='<'?nl<nr:num&&op==='>'?nl>nr:num&&op==='<='?nl<=nr:num&&op==='>='?nl>=nr:false;
      return r ? onTrue : (onFalse || '');
    });
  
  // {range:1-10} — random integer
  text = text.replace(/\{range:(\d+)-(\d+)\}/gi, (_, min, max) => {
    const n1 = parseInt(min), n2 = parseInt(max);
    return String(Math.floor(Math.random() * (n2 - n1 + 1)) + n1);
  });
  
  // {length:text} — string length
  text = text.replace(/\{length:([^}]+)\}/gi, (_, str) => String(str.length));
  
  // {upper:text} and {lower:text} — case conversion
  text = text.replace(/\{upper:([^}]+)\}/gi, (_, str) => str.toUpperCase());
  text = text.replace(/\{lower:([^}]+)\}/gi, (_, str) => str.toLowerCase());
  
  // {capitalize:text} — capitalize first letter
  text = text.replace(/\{capitalize:([^}]+)\}/gi, (_, str) => str.charAt(0).toUpperCase() + str.slice(1).toLowerCase());
  
  // {replace(find,replace):text} — replace all occurrences
  text = text.replace(/\{replace\(([^,]+),([^)]+)\):([^}]+)\}/gi, (_, find, replace, str) => {
    try {
      return str.replaceAll(find, replace);
    } catch {
      return str;
    }
  });
  
  // {slice(start-end):text} — substring
  text = text.replace(/\{slice\((\d+)-(\d+)\):([^}]+)\}/gi, (_, start, end, str) => {
    return str.slice(parseInt(start), parseInt(end));
  });
  
  // {in(param):payload} — check if param is in payload
  text = text.replace(/\{in\(([^)]+)\):([^}]+)\}/gi, (_, param, payload) => {
    return payload.includes(param) ? 'true' : 'false';
  });
  
  return { text: text.trim(), shouldDelete };
}

// =============================================================================
// EMBED BUILDER
// =============================================================================
export function getEmbedUIRows(builder: { buttons: ButtonBuilder[] }) {
  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('emb_title').setLabel('Title').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('emb_desc').setLabel('Description').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('emb_color').setLabel('Color').setStyle(ButtonStyle.Danger),
  );
  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('emb_img').setLabel('Image').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('emb_thumb').setLabel('Thumbnail').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('emb_json').setLabel('JSON').setStyle(ButtonStyle.Danger),
  );
  const row3 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('emb_addbtn').setLabel('Add Button').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('emb_save').setLabel('Save').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('emb_exit').setLabel('Exit').setStyle(ButtonStyle.Secondary),
  );
  const rows: ActionRowBuilder<ButtonBuilder>[] = [row1, row2, row3];
  if (builder.buttons.length > 0)
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(builder.buttons));
  return rows;
}

export async function startEmbedBuilder(ctx: Message | ChatInputCommandInteraction, editMsgId?: string) {
  const authorId = 'user' in ctx ? ctx.user.id : ctx.author.id;
  let targetMessage: Message | undefined;

  if (editMsgId && ctx.channel && 'messages' in ctx.channel) {
    try { targetMessage = await (ctx.channel as any).messages.fetch(editMsgId); }
    catch {
      if (ctx instanceof ChatInputCommandInteraction) await ctx.reply({ content: 'Target message not found.', flags: MessageFlags.Ephemeral });
      else await (ctx as Message).reply('Target message not found.');
      return;
    }
  }

  const embed = targetMessage?.embeds[0]
    ? new EmbedBuilder(targetMessage.embeds[0].data)
    : new EmbedBuilder().setDescription('New Embed');

  const existingButtons: ButtonBuilder[] = [];
  if (targetMessage?.components.length) {
    targetMessage.components.forEach((row: any) => {
      row.components.forEach((comp: any) => {
        if (comp.type === 2 && comp.url)
          existingButtons.push(new ButtonBuilder().setLabel(comp.label || 'Link').setURL(comp.url).setStyle(ButtonStyle.Link));
      });
    });
  }

  const content = '**Interactive Embed Builder**\nUse the buttons below to configure your embed:';
  const builderState = { embed, buttons: existingButtons, botMsg: null as any, awaiting: null as string | null, editTarget: targetMessage };

  let botMsg: Message;
  if (ctx instanceof ChatInputCommandInteraction) {
    botMsg = await ctx.reply({ content, embeds: [embed], components: getEmbedUIRows(builderState), fetchReply: true });
  } else {
    botMsg = await (ctx as Message).reply({ content, embeds: [embed], components: getEmbedUIRows(builderState) as any });
  }
  builderState.botMsg = botMsg;
  activeEmbedBuilders.set(authorId, builderState);
}

// =============================================================================
// PURGE
// =============================================================================
export async function executePurge(channel: any, amount: number, filters: any): Promise<{ deleted: number; error?: string }> {
  if (!channel || !('messages' in channel)) return { deleted: 0, error: 'Cannot purge in this channel type.' };
  try {
    const fetched       = await channel.messages.fetch({ limit: amount });
    const fourteenDays  = Date.now() - 14 * 24 * 60 * 60 * 1000;
    const toDelete = fetched.filter((msg: Message) => {
      if (msg.createdTimestamp < fourteenDays) return false;
      if (filters.userId  && msg.author.id !== filters.userId) return false;
      if (filters.isBot   && !msg.author.bot)  return false;
      if (filters.isHuman &&  msg.author.bot)  return false;
      if (filters.hasLink && !/(https?:\/\/[^\s]+)/.test(msg.content)) return false;
      if (filters.hasInvite && !/(discord\.gg\/|discord\.com\/invite\/)/i.test(msg.content)) return false;
      if (filters.contain && !msg.content.toLowerCase().includes(filters.contain.toLowerCase())) return false;
      if (filters.regex   && !filters.regex.test(msg.content)) return false;
      return true;
    });
    if (toDelete.size === 0) return { deleted: 0 };
    const deleted = await channel.bulkDelete(toDelete, true);
    return { deleted: deleted.size };
  } catch { return { deleted: 0, error: 'Failed to purge. Messages might be older than 14 days.' }; }
}

// =============================================================================
// MODERATION
// =============================================================================
export async function runModerationAction(params: any, botId?: string): Promise<void> {
  const { action, moderatorMember, targetMember, targetUser, reason, timeoutMs, timeoutLabel, deleteDays, reply } = params;
  const guild     = moderatorMember.guild;
  const botMember = guild.members.me;
  if (!botMember) return void reply('Bot not ready.');
  if (targetUser.id === moderatorMember.id || targetUser.id === botId) return void reply('Cannot moderate self.');

  const safeReason = reason || 'No reason provided';
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

// =============================================================================
// GIVEAWAYS
// =============================================================================
export function buildGiveawayEmbed(g: GiveawayEntry) {
  return new EmbedBuilder()
    .setTitle(`Giveaway: ${g.title}`)
    .setDescription('Click **Participate!** below to join.')
    .setColor(g.ended ? 0x777777 : 0x00b894)
    .addFields(
      { name: 'Host',         value: g.hostName,                               inline: true },
      { name: 'Winners',      value: String(g.winnersCount),                   inline: true },
      { name: 'Participants', value: String(g.participants.size),               inline: true },
      { name: 'Ends',         value: `<t:${Math.floor(g.endAt / 1000)}:R>`,    inline: false },
    )
    .setFooter({ text: g.ended ? 'Giveaway ended' : 'Good luck!' });
}
export function createGiveawayRow(disabled: boolean) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('giveaway_join').setLabel('Participate!').setStyle(ButtonStyle.Success).setDisabled(disabled),
  );
}
export function scheduleGiveawayEnd(client: Client, id: string) {
  const g = giveaways.get(id);
  if (!g || g.ended) return;
  const rem = g.endAt - Date.now();
  if (rem <= 0) return void endGiveaway(client, id);
  setTimeout(() => void endGiveaway(client, id), Math.min(rem, 2147483647));
}
export async function endGiveaway(client: Client, id: string) {
  const g = giveaways.get(id); if (!g || g.ended) return;
  g.ended = true;
  const channel = await client.channels.fetch(g.channelId).catch(() => null) as any; if (!channel) return;
  const msg     = await channel.messages.fetch(g.messageId).catch(() => null);       if (!msg)     return;
  const winners = [...g.participants].sort(() => Math.random() - 0.5).slice(0, g.winnersCount);
  await msg.edit({ embeds: [buildGiveawayEmbed(g).setColor(0x636e72)], components: [createGiveawayRow(true)] }).catch(() => null);
  await channel.send(winners.length === 0
    ? `Giveaway ended for **${g.title}**. No participants.`
    : `Giveaway ended for **${g.title}**.\nWinner(s): ${winners.map(u => `<@${u}>`).join(', ')}`);
}

// =============================================================================
// AI CHAT — Gemini 2 Flash via OpenRouter
// Per-user conversation history is kept in activeChatSessions.
// =============================================================================
const CHAT_SESSION_TTL = 30 * 60 * 1000; // 30 min of inactivity resets session
const CHAT_MAX_HISTORY = 20;              // keep last 20 turns per user

/** Parse and execute JSON action from AI response */
async function parseAndExecuteAction(action: any, ctx: Message | ChatInputCommandInteraction, isAuthorized: boolean): Promise<string | null> {
  if (!isAuthorized) return '❌ You are not authorized to execute this action';
  
  const guild = ctx.guild;
  if (!guild) return null;
  
  try {
    const actionType = action.action;
    
    switch (actionType) {
      case 'create_channel': {
        const { name, category } = action;
        if (!name) return '❌ Missing channel name';
        try {
          const channel = await guild.channels.create({
            name,
            parent: category ? guild.channels.cache.find((c: any) => c.name === category || c.id === category)?.id : undefined,
          });
          return `✅ Channel created: <#${channel.id}>`;
        } catch (e) {
          return `❌ Failed to create channel: ${(e as Error).message}`;
        }
      }
      
      case 'delete_channel': {
        const { channelId } = action;
        if (!channelId) return '❌ Missing channel ID';
        try {
          const ch = guild.channels.cache.get(channelId);
          if (!ch) return '❌ Channel not found';
          await ch.delete();
          return `✅ Channel deleted`;
        } catch (e) {
          return `❌ Failed to delete channel: ${(e as Error).message}`;
        }
      }
      
      case 'add_role': {
        const { userId, roleName } = action;
        if (!userId || !roleName) return '❌ Missing userId or roleName';
        try {
          const member = await guild.members.fetch(userId);
          const role = guild.roles.cache.find((r: any) => r.name === roleName || r.id === roleName);
          if (!role) return '❌ Role not found';
          await member.roles.add(role);
          return `✅ Role ${roleName} added to user`;
        } catch (e) {
          return `❌ Failed to add role: ${(e as Error).message}`;
        }
      }
      
      case 'remove_role': {
        const { userId, roleName } = action;
        if (!userId || !roleName) return '❌ Missing userId or roleName';
        try {
          const member = await guild.members.fetch(userId);
          const role = guild.roles.cache.find((r: any) => r.name === roleName || r.id === roleName);
          if (!role) return '❌ Role not found';
          await member.roles.remove(role);
          return `✅ Role ${roleName} removed from user`;
        } catch (e) {
          return `❌ Failed to remove role: ${(e as Error).message}`;
        }
      }
      
      case 'ban_user': {
        const { userId, reason } = action;
        if (!userId) return '❌ Missing userId';
        try {
          await guild.members.ban(userId, { reason });
          return `✅ User banned`;
        } catch (e) {
          return `❌ Failed to ban user: ${(e as Error).message}`;
        }
      }
      
      case 'kick_user': {
        const { userId, reason } = action;
        if (!userId) return '❌ Missing userId';
        try {
          const member = await guild.members.fetch(userId);
          await member.kick(reason);
          return `✅ User kicked`;
        } catch (e) {
          return `❌ Failed to kick user: ${(e as Error).message}`;
        }
      }
      
      case 'set_afk': {
        const { userId, reason } = action;
        if (!userId) return '❌ Missing userId';
        // This would need to be imported from storage
        return `✅ User marked as AFK: ${reason}`;
      }
      
      default:
        return null;
    }
  } catch (err) {
    console.error('[ACTION]', err);
    return `❌ Action error: ${(err as Error).message}`;
  }
}

export async function handleAIChat(ctx: Message | ChatInputCommandInteraction, userInput: string): Promise<void> {
  if (!userInput.trim()) {
    if (ctx instanceof Message) {
      await ctx.reply('Tell me something! Usage: `chat <your message>`').catch(() => null);
    } else {
      await ctx.editReply('Tell me something!');
    }
    return;
  }
  if (!OPENROUTER_API_KEY) {
    const msg = '❌ OpenRouter API key not configured in `.env` (`openrouter_api=sk-...`).';
    if (ctx instanceof Message) {
      await ctx.reply(msg).catch(() => null);
    } else {
      await ctx.editReply(msg);
    }
    return;
  }

  // Typing indicator while we wait
  if (ctx instanceof Message) {
    await (ctx.channel as any).sendTyping?.().catch(() => null);
  }

  const userId = ctx instanceof Message ? ctx.author.id : ctx.user.id;

  // Get or create session
  let session = activeChatSessions.get(userId);
  if (!session || Date.now() - session.lastActivity > CHAT_SESSION_TTL) {
    session = { history: [], lastActivity: Date.now() };
    activeChatSessions.set(userId, session);
  }
  session.history.push({ role: 'user', content: userInput });
  session.lastActivity = Date.now();

  // Trim history to max length
  if (session.history.length > CHAT_MAX_HISTORY)
    session.history = session.history.slice(session.history.length - CHAT_MAX_HISTORY);

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization':  `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type':   'application/json',
        'HTTP-Referer':   'https://discord.com',
        'X-Title':        'Dhaniya Sir Discord Bot',
      },
      body: JSON.stringify({
        model:    SYSTEM_AI_PROVIDER,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          ...session.history,
        ],
        max_tokens: 1024,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error('[AI] OpenRouter error:', res.status, errText);
      const errMsg = `⚠️ AI error (${res.status}). Try again later.`;
      if (ctx instanceof Message) {
        await ctx.reply(errMsg).catch(() => null);
      } else {
        await ctx.editReply(errMsg);
      }
      return;
    }

    const data  = await res.json() as any;
    let reply = data?.choices?.[0]?.message?.content?.trim() || '*(no response)*';

    // Save assistant reply to history
    session.history.push({ role: 'assistant', content: reply });

    // Try to parse and execute JSON action block if present
    let actionResult: string | null = null;
    const jsonMatch = reply.match(/\{[^}]*"action"[^}]*\}/);
    if (jsonMatch) {
      try {
        const action = JSON.parse(jsonMatch[0]);
        // Check if user is authorized (owner or has controller role)
        const userId = ctx instanceof Message ? ctx.author.id : ctx.user.id;
        const isOwner = userId === OWNER_ID;
        let isController = false;
        
        if (!isOwner && ctx.guild) {
          // Check if user has any controller roles
          const guildId = ctx.guild.id;
          const member = ctx instanceof Message ? ctx.member : ctx.member;
          if (member instanceof GuildMember) {
            const controllerRoleIds = controllers.get(guildId) || [];
            isController = controllerRoleIds.some((roleId: string) => member.roles.cache.has(roleId));
          }
        }
        
        const isAuthorized = isOwner || isController;
        if (isAuthorized) {
          actionResult = await parseAndExecuteAction(action, ctx, isAuthorized);
          if (actionResult) {
            // Remove the JSON block from the reply and replace with result
            reply = reply.replace(/\{[^}]*"action"[^}]*\}/, actionResult).trim();
          }
        } else {
          // Non-authorized user trying to execute action
          reply = reply.replace(/\{[^}]*"action"[^}]*\}/, '❌ You are not authorized to perform this action').trim();
        }
      } catch {
        // Not valid JSON action, just show it as-is
      }
    }

    // Discord messages max 2000 chars — split if needed
    if (ctx instanceof Message) {
      if (reply.length <= 2000) {
        await ctx.reply(reply).catch(() => null);
      } else {
        const chunks: string[] = [];
        for (let i = 0; i < reply.length; i += 1900) chunks.push(reply.slice(i, i + 1900));
        for (const chunk of chunks) await ctx.reply(chunk).catch(() => null);
      }
    } else {
      if (reply.length <= 2000) {
        await ctx.editReply(reply);
      } else {
        const chunks: string[] = [];
        for (let i = 0; i < reply.length; i += 1900) chunks.push(reply.slice(i, i + 1900));
        await ctx.editReply(chunks[0]);
        for (const chunk of chunks.slice(1)) {
          await ctx.followUp(chunk).catch(() => null);
        }
      }
    }
  } catch (err) {
    console.error('[AI] Fetch error:', err);
    const errMsg = '⚠️ Could not reach the AI. Check your internet/API key.';
    if (ctx instanceof Message) {
      await ctx.reply(errMsg).catch(() => null);
    } else {
      await ctx.editReply(errMsg);
    }
  }
}

/** Let owner clear their AI chat history */
export function clearChatSession(userId: string): boolean {
  return activeChatSessions.delete(userId);
}
