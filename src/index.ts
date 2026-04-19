import 'dotenv/config';
import http from 'node:http';
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ChatInputCommandInteraction, Client, EmbedBuilder,
  Events, GatewayIntentBits, GuildMember,
  Message, MessageFlags, ModalBuilder,
  PermissionFlagsBits, TextInputBuilder, TextInputStyle,
} from 'discord.js';

// ── Config ────────────────────────────────────────────────────────────────────
import { PORT, TOKEN, OWNER_ID, SETTINGS_FILE, TAG_FILE, ALIAS_FILE, AFK_FILE } from './config';

// ── Storage ───────────────────────────────────────────────────────────────────
import {
  afks, tags, aliases, giveaways, activeEmbedBuilders,
  saveStore, savePrefixStore, ensureGuildBucket, prefixes,
  DEFAULT_PREFIXES, GLOBAL_ALIASES,
  setDefaultPrefixes, setGlobalAliases, GiveawayEntry,
} from './storage';

// ── Slash command definitions ─────────────────────────────────────────────────
import { slashCommands } from './commands';

// ── All helper / utility functions + AI ──────────────────────────────────────
import {
  registerSlashCommands, startEmbedBuilder, getEmbedUIRows,
  buildGiveawayEmbed, createGiveawayRow, scheduleGiveawayEnd,
  parseDurationToken, sendToChannel, executePurge, runModerationAction,
  resolveMatchedPrefix, getPrimaryPrefix, getGuildPrefixes,
  processTagScript, getUptimeText, buildHelpText,
  chooseRandom, safeCalculate, sanitizeKey, normalizeHex,
  handleAIChat, clearChatSession,
} from './utils';

// =============================================================================
// CLIENT
// =============================================================================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
  ],
});

// WS diagnostics — visible in Render's log dashboard
client.on('error',           (err)    => console.error('[WS] Error:', err.message));
client.on('warn',            (msg)    => console.warn('[WS] Warn:', msg));
client.on('shardDisconnect', (ev, id) => console.warn(`[WS] Shard ${id} disconnected (code ${ev.code})`));
client.on('shardReconnecting',(id)    => console.log(`[WS] Shard ${id} reconnecting...`));
client.on('shardResume',     (id, r)  => console.log(`[WS] Shard ${id} resumed (${r} events)`));

if (PORT) {
  http.createServer((req, res) => {
    res.writeHead(200);
    res.end(req.url === '/healthz' ? 'ok' : 'Dhaniya Sir is running');
  }).listen(PORT, '0.0.0.0');
}

// =============================================================================
// SLASH COMMAND HANDLER
// =============================================================================
async function handleSlash(interaction: ChatInputCommandInteraction): Promise<void> {
  const name = interaction.commandName;

  if (name === 'ping')    return void interaction.reply({ content: `Ping Pong Is **${client.ws.ping}ms~**`, flags: MessageFlags.Ephemeral });
  if (name === 'uptime')  return void interaction.reply(`Uptime: **${getUptimeText()}**`);
  if (name === 'help')    return void interaction.reply({ content: buildHelpText(getPrimaryPrefix(interaction.guildId)), flags: MessageFlags.Ephemeral });
  if (name === 'botinfo') return void interaction.reply([`Bot: **${client.user?.tag || 'Unknown'}**`, `ID: \`${client.user?.id || 'N/A'}\``, `Servers: **${client.guilds.cache.size}**`, `Uptime: **${getUptimeText()}**`].join('\n'));
  if (name === 'guildid') return void interaction.reply({ content: `Guild ID: ${interaction.guildId || 'N/A'}`, flags: MessageFlags.Ephemeral });

  if (name === 'afk') {
    const reason = interaction.options.getString('reason') || 'AFK';
    afks[interaction.user.id] = { reason, time: Date.now() }; saveStore(AFK_FILE, afks);
    return void interaction.reply({ content: `You are now AFK: **${reason}**`, flags: MessageFlags.Ephemeral });
  }

  if (name === 'choose') {
    const options = interaction.options.getString('options', true).split(',').map(o => o.trim()).filter(Boolean);
    if (options.length < 2) return void interaction.reply('Provide at least 2 options separated by commas.');
    return void interaction.reply(`I choose: **${chooseRandom(options)}**`);
  }
  if (name === 'roll') {
    const sides = interaction.options.getInteger('sides') || 6;
    return void interaction.reply(`Rolled d${sides}: **${Math.floor(Math.random() * sides) + 1}**`);
  }
  if (name === 'coinflip') return void interaction.reply(`Coin: **${Math.random() < 0.5 ? 'Heads' : 'Tails'}**`);
  if (name === '8ball') {
    const answers = ['Yes.', 'No.', 'Maybe.', 'Definitely.', 'Not likely.', 'Ask again later.', 'It is certain.', 'Very doubtful.'];
    return void interaction.reply(`Question: ${interaction.options.getString('question', true)}\n8-Ball: **${chooseRandom(answers)}**`);
  }
  if (name === 'reverse') return void interaction.reply(interaction.options.getString('text', true).split('').reverse().join(''));
  if (name === 'calc') {
    const res = safeCalculate(interaction.options.getString('expression', true));
    return void interaction.reply(res !== null ? `Result: **${res}**` : 'Invalid expression.');
  }

  if (name === 'giveaway') {
    const channel = interaction.options.getChannel('channel', true);
    const modal   = new ModalBuilder().setCustomId(`giveaway_create:${channel.id}:${interaction.guildId}`).setTitle('Create Giveaway');
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('duration').setLabel('Duration (ex: 10min, 1day)').setStyle(TextInputStyle.Short).setRequired(true)),
      new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('title').setLabel('Prize').setStyle(TextInputStyle.Short).setRequired(true)),
      new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('winners').setLabel('Winners').setStyle(TextInputStyle.Short).setRequired(true).setValue('1')),
      new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('host').setLabel('Host').setStyle(TextInputStyle.Short).setRequired(true).setValue(interaction.user.tag)),
    );
    return void interaction.showModal(modal);
  }

  if (name === 'synccommands') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await registerSlashCommands(slashCommands, interaction.guildId || undefined);
    return void interaction.editReply(result.ok ? 'Commands synced for this server.' : 'Sync failed. Check permissions.');
  }

  if (name === 'prefix' && interaction.guildId) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'add') {
      const val = interaction.options.getString('value', true).trim();
      if (val.length > 5) return void interaction.reply({ content: 'Max 5 chars.', flags: MessageFlags.Ephemeral });
      prefixes[interaction.guildId] = val; savePrefixStore(SETTINGS_FILE, prefixes);
      return void interaction.reply(`Prefix set to \`${val}\``);
    }
    if (sub === 'remove') { delete prefixes[interaction.guildId]; savePrefixStore(SETTINGS_FILE, prefixes); return void interaction.reply('Prefix reset to global defaults.'); }
    if (sub === 'list')   return void interaction.reply(`Active prefixes: \`${getGuildPrefixes(interaction.guildId).join('`, `')}\``);
    return;
  }

  if (name === 'say') {
    const channel = interaction.options.getChannel('channel') || interaction.channel;
    await interaction.reply({ content: 'Sent.', flags: MessageFlags.Ephemeral });
    return void sendToChannel(channel, interaction.options.getString('text', true));
  }
  if (name === 'avatar') {
    const user = interaction.options.getUser('user') || interaction.user;
    return void interaction.reply(`Avatar of **${user.tag}**: ${user.displayAvatarURL({ size: 1024 })}`);
  }
  if (name === 'userinfo') {
    await interaction.deferReply();
    const user   = interaction.options.getUser('user') || interaction.user;
    const member = interaction.guild ? await interaction.guild.members.fetch(user.id).catch(() => null) : null;
    return void interaction.editReply([`User: **${user.tag}**`, `ID: \`${user.id}\``, `Created: **${user.createdAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} (IST)**`, `Joined: **${member?.joinedAt?.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) ?? 'Unknown'}**`].join('\n'));
  }
  if (name === 'serverinfo') {
    if (!interaction.guild) return void interaction.reply({ content: 'Use this in a server.', flags: MessageFlags.Ephemeral });
    return void interaction.reply([`Server: **${interaction.guild.name}**`, `ID: \`${interaction.guild.id}\``, `Members: **${interaction.guild.memberCount}**`, `Created: **${interaction.guild.createdAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} (IST)**`].join('\n'));
  }

  if (name === 'embed') { await startEmbedBuilder(interaction, interaction.options.getString('message_id') || undefined); return; }

  if (name === 'tagscript') {
    const tagName = sanitizeKey(interaction.options.getString('name', true));
    const content = tags[interaction.guildId!]?.[tagName];
    if (!content) return void interaction.reply({ content: `Tag not found: ${tagName}`, flags: MessageFlags.Ephemeral });
    const parsed = await processTagScript(content, interaction, []);
    return void interaction.reply(parsed.text || '*(Empty Output)*');
  }

  if (name === 'alias') {
    const trigger = sanitizeKey(interaction.options.getString('trigger', true));
    const output  = interaction.options.getString('output', true).trim();
    ensureGuildBucket(aliases, interaction.guildId!)[trigger] = output; saveStore(ALIAS_FILE, aliases);
    return void interaction.reply({ content: `Alias set: **${trigger}** -> ${output}`, flags: MessageFlags.Ephemeral });
  }
  if (name === 'aliasdel') {
    const trigger     = sanitizeKey(interaction.options.getString('trigger', true));
    const guildBucket = ensureGuildBucket(aliases, interaction.guildId!);
    if (!guildBucket[trigger]) return void interaction.reply({ content: `Alias not found: ${trigger}`, flags: MessageFlags.Ephemeral });
    delete guildBucket[trigger]; saveStore(ALIAS_FILE, aliases);
    return void interaction.reply({ content: `Removed alias: **${trigger}**`, flags: MessageFlags.Ephemeral });
  }
  if (name === 'aliases') {
    const keys = Object.keys(aliases[interaction.guildId!] || {});
    return void interaction.reply({ content: keys.length ? `Aliases:\n${keys.map(k => `- ${k}`).join('\n')}` : 'No aliases yet.', flags: MessageFlags.Ephemeral });
  }

  if (name === 'tag') {
    const sub        = interaction.options.getSubcommand();
    const guildTags  = ensureGuildBucket(tags, interaction.guildId!);
    if (sub === 'create') {
      const tagName = sanitizeKey(interaction.options.getString('name', true));
      const modal   = new ModalBuilder().setCustomId(`tag_create:${interaction.guildId}:${tagName}`).setTitle('Create Tag');
      modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId('content').setLabel('Content').setStyle(TextInputStyle.Paragraph).setRequired(true).setValue(guildTags[tagName] || ''),
      ));
      return void interaction.showModal(modal);
    }
    if (sub === 'view') {
      const tagName = sanitizeKey(interaction.options.getString('name', true));
      const content = guildTags[tagName];
      if (!content) return void interaction.reply(`Tag not found: ${tagName}`);
      const parsed = await processTagScript(content, interaction, []);
      return void interaction.reply(parsed.text || '*(Empty Output)*');
    }
    if (sub === 'delete') {
      const tagName = sanitizeKey(interaction.options.getString('name', true));
      delete guildTags[tagName]; saveStore(TAG_FILE, tags);
      return void interaction.reply(`Deleted tag: ${tagName}`);
    }
    if (sub === 'list') return void interaction.reply(`Tags: ${Object.keys(guildTags).join(', ') || 'None'}`);
    return;
  }

  if (name === 'purge') {
    const amount     = interaction.options.getInteger('amount', true);
    const targetChan = interaction.options.getChannel('channel') || interaction.channel;
    const regexStr   = interaction.options.getString('regex');
    let regexPattern: RegExp | undefined;
    if (regexStr) { try { regexPattern = new RegExp(regexStr); } catch { return void interaction.reply({ content: 'Invalid Regex.', flags: MessageFlags.Ephemeral }); } }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const res = await executePurge(targetChan, amount, {
      userId:    interaction.options.getUser('user')?.id,
      isBot:     interaction.options.getString('filter') === 'bot',
      isHuman:   interaction.options.getString('filter') === 'human',
      hasLink:   interaction.options.getString('filter') === 'link',
      hasInvite: interaction.options.getString('filter') === 'invite',
      contain:   interaction.options.getString('contain'),
      regex:     regexPattern,
    });
    return void interaction.editReply(res.error || `Successfully deleted **${res.deleted}** message(s).`);
  }

  if (name === 'role') {
    if (!interaction.guild || !(interaction.member instanceof GuildMember)) return;
    const botMember = interaction.guild.members.me;
    if (!botMember?.permissions.has(PermissionFlagsBits.ManageRoles)) return void interaction.reply('I need Manage Roles permission.');
    await interaction.deferReply();
    const sub  = interaction.options.getSubcommand();
    if (sub === 'create') {
      const role = await interaction.guild.roles.create({ name: interaction.options.getString('name', true) });
      return void interaction.editReply(`Role created: ${role}`);
    }
    const roleOption = interaction.options.getRole('role', true);
    const role       = interaction.guild.roles.cache.get(roleOption.id);
    if (!role || role.position >= botMember.roles.highest.position) return void interaction.editReply('Cannot manage this role due to hierarchy.');
    if (sub === 'del') { await role.delete(); return void interaction.editReply('Deleted role.'); }
    if (sub === 'ren') { await role.edit({ name: interaction.options.getString('name', true) }); return void interaction.editReply('Renamed role.'); }
    const user   = interaction.options.getUser('user', true);
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member) return void interaction.editReply('User not found.');
    if (sub === 'add') { await member.roles.add(role);    return void interaction.editReply(`Added ${role} to ${member.user.tag}`); }
    if (sub === 'rem') { await member.roles.remove(role); return void interaction.editReply(`Removed ${role} from ${member.user.tag}`); }
    return;
  }

  if (['kick', 'ban', 'timeout', 'mute', 'untimeout', 'unmute'].includes(name)) {
    if (!interaction.guild || !(interaction.member instanceof GuildMember)) return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const user   = interaction.options.getUser('user', true);
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    const params: any = {
      action:          name === 'mute' ? 'timeout' : name === 'unmute' ? 'untimeout' : name,
      moderatorMember: interaction.member, targetMember: member, targetUser: user,
      reason:          interaction.options.getString('reason') || undefined,
      reply:           async (msg: string) => void interaction.editReply({ content: msg }),
    };
    if (name === 'ban') params.deleteDays = interaction.options.getInteger('delete_days') || 0;
    if (name === 'timeout' || name === 'mute') {
      const mins = interaction.options.getInteger('minutes', true);
      params.timeoutMs = mins * 60000; params.timeoutLabel = `${mins}min`;
    }
    await runModerationAction(params, client.user!.id);
  }
}

// =============================================================================
// EVENT: READY
// =============================================================================
client.once(Events.ClientReady, async c => {
  console.log(`[READY] Online as ${c.user.tag}!`);
  // Fire-and-forget: never block the ready event on HTTP calls
  registerSlashCommands(slashCommands).then(r => {
    console.log(`[CMDS] Slash sync: ${r.ok ? 'OK' : 'FAILED (non-fatal)'}`);
  }).catch(err => console.error('[CMDS] Slash sync error:', err));
});

// =============================================================================
// EVENT: INTERACTIONS
// =============================================================================
client.on(Events.InteractionCreate, async i => {
  try {
    if (i.isChatInputCommand()) return void handleSlash(i);

    // ── Embed Builder Buttons ──────────────────────────────────────────────
    if (i.isButton() && i.customId.startsWith('emb_')) {
      const builder = activeEmbedBuilders.get(i.user.id);
      if (!builder || builder.botMsg.id !== i.message.id)
        return void i.reply({ content: 'This session has expired.', flags: MessageFlags.Ephemeral });

      const action = i.customId.replace('emb_', '');
      if (action === 'save') {
        const finalComponents = builder.buttons.length > 0 ? [new ActionRowBuilder<ButtonBuilder>().addComponents(builder.buttons)] : [];
        if (builder.editTarget) {
          await builder.editTarget.edit({ embeds: [builder.embed], components: finalComponents as any }).catch(() => null);
          await i.reply({ content: 'Embed edited successfully!', flags: MessageFlags.Ephemeral });
        } else {
          await sendToChannel(i.channel, { embeds: [builder.embed], components: finalComponents });
          await i.reply({ content: 'Embed sent successfully!', flags: MessageFlags.Ephemeral });
        }
        await builder.botMsg.delete().catch(() => null);
        activeEmbedBuilders.delete(i.user.id);
        return;
      }
      if (action === 'exit') {
        await builder.botMsg.delete().catch(() => null);
        activeEmbedBuilders.delete(i.user.id);
        return void i.reply({ content: 'Embed creation cancelled.', flags: MessageFlags.Ephemeral });
      }
      builder.awaiting = action;
      if (action === 'addbtn')
        return void i.reply({ content: 'Give button content in chat. Format: `Label | https://link.com` (within 10 minutes)', flags: MessageFlags.Ephemeral });
      const prompts: Record<string, string> = { title: 'title', desc: 'description', color: 'hex color (like #FF0000)', img: 'image URL', thumb: 'thumbnail URL', json: 'raw JSON format' };
      return void i.reply({ content: `Enter ${prompts[action]} in the chat within next 10 minutes.`, flags: MessageFlags.Ephemeral });
    }

    // ── Tag Modal ─────────────────────────────────────────────────────────
    if (i.isModalSubmit() && i.customId.startsWith('tag_create:')) {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const [, guildId, tagName] = i.customId.split(':');
      const content = i.fields.getTextInputValue('content').trim();
      ensureGuildBucket(tags, guildId!)[tagName!] = content; saveStore(TAG_FILE, tags);
      return void i.editReply({ content: `Tag created: **${tagName}**` });
    }

    // ── Giveaway Modal ────────────────────────────────────────────────────
    if (i.isModalSubmit() && i.customId.startsWith('giveaway_create:')) {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const [, channelId, guildId] = i.customId.split(':');
      const parsed = parseDurationToken(i.fields.getTextInputValue('duration'));
      if (!parsed.ok) return void i.editReply({ content: 'Invalid duration.' });
      const channel = await client.channels.fetch(channelId!).catch(() => null);
      if (!channel) return void i.editReply({ content: 'Channel not found.' });
      const giveaway: GiveawayEntry = {
        messageId: '', guildId: guildId!, channelId: channelId!,
        title:        i.fields.getTextInputValue('title'),
        hostName:     i.fields.getTextInputValue('host'),
        winnersCount: Number(i.fields.getTextInputValue('winners')),
        endAt:        Date.now() + parsed.ms,
        participants: new Set<string>(), ended: false,
      };
      const sent = await sendToChannel(channel, { embeds: [buildGiveawayEmbed(giveaway)], components: [createGiveawayRow(false)] });
      if (!sent) return void i.editReply({ content: 'Failed to send giveaway message.' });
      giveaway.messageId = sent.id; giveaways.set(sent.id, giveaway); scheduleGiveawayEnd(client, sent.id);
      return void i.editReply({ content: `Giveaway created in <#${channelId}>.` });
    }

    // ── Giveaway Join Button ──────────────────────────────────────────────
    if (i.isButton() && i.customId === 'giveaway_join') {
      const giveaway = giveaways.get(i.message.id);
      if (!giveaway || giveaway.ended) return void i.reply({ content: 'Giveaway inactive.', flags: MessageFlags.Ephemeral });
      if (giveaway.participants.has(i.user.id)) return void i.reply({ content: 'Already joined.', flags: MessageFlags.Ephemeral });
      giveaway.participants.add(i.user.id);
      return void i.update({ embeds: [buildGiveawayEmbed(giveaway)] });
    }
  } catch (err) { console.error('Interaction error:', err); }
});

// =============================================================================
// EVENT: MESSAGES
// =============================================================================
client.on(Events.MessageCreate, async (m: Message) => {
  if (m.author.bot) return;

  // AFK: welcome back
  if (afks[m.author.id]) {
    delete afks[m.author.id]; saveStore(AFK_FILE, afks);
    const r = await m.reply(`Welcome back <@${m.author.id}>! I removed your AFK.`).catch(() => null);
    if (r) setTimeout(() => r.delete().catch(() => null), 5000);
  }
  // AFK: mention check
  m.mentions.users.forEach(u => {
    if (afks[u.id]) m.reply(`**${u.tag}** is AFK right now! Reason: "**${afks[u.id].reason}**"`).catch(() => null);
  });

  // Embed builder input
  if (activeEmbedBuilders.has(m.author.id)) {
    const builder = activeEmbedBuilders.get(m.author.id)!;
    if (builder.awaiting) {
      let success = true;
      try {
        if (builder.awaiting === 'title') builder.embed.setTitle(m.content.slice(0, 256));
        else if (builder.awaiting === 'desc')  builder.embed.setDescription(m.content.slice(0, 4096));
        else if (builder.awaiting === 'color') builder.embed.setColor(normalizeHex(m.content) || null);
        else if (builder.awaiting === 'img')   builder.embed.setImage(m.content);
        else if (builder.awaiting === 'thumb') builder.embed.setThumbnail(m.content);
        else if (builder.awaiting === 'json')  builder.embed = new EmbedBuilder(JSON.parse(m.content));
        else if (builder.awaiting === 'addbtn') {
          const parts = m.content.split('|').map(p => p.trim());
          if (parts.length < 2 || !parts[1].startsWith('http')) throw new Error('Invalid format');
          builder.buttons.push(new ButtonBuilder().setLabel(parts[0]).setURL(parts[1]).setStyle(ButtonStyle.Link));
        }
      } catch {
        success = false;
        const err = await m.reply('Invalid input format!').catch(() => null);
        if (err) setTimeout(() => err.delete().catch(() => null), 3000);
      }
      builder.awaiting = null;
      if (success) await builder.botMsg.edit({ embeds: [builder.embed], components: getEmbedUIRows(builder) as any }).catch(() => null);
      if (m.deletable) await m.delete().catch(() => null);
      return;
    }
  }

  // Alias triggers
  const words = m.content.split(/\s+/);
  let aliasReply: string | null = null, aliasArgs: string[] = [];
  for (let i = words.length; i > 0; i--) {
    const trigger = words.slice(0, i).join(' ').toLowerCase();
    const found   = (m.guildId && aliases[m.guildId]?.[trigger]) || GLOBAL_ALIASES[trigger];
    if (found) { aliasReply = found; aliasArgs = words.slice(i); break; }
  }
  if (aliasReply) {
    const parsed = await processTagScript(aliasReply, m, aliasArgs);
    if (parsed.shouldDelete && m.deletable) await m.delete().catch(() => null);
    if (parsed.text) {
      if (parsed.shouldDelete) await sendToChannel(m.channel, parsed.text);
      else await m.reply(parsed.text).catch(() => null);
    }
    return;
  }

  // Prefix check
  const prefix = resolveMatchedPrefix(m.guildId, m.content);
  if (!prefix) return;

  const args = m.content.slice(prefix.length).trim().split(/\s+/);
  const cmd  = args.shift()?.toLowerCase();

  // ==========================================================================
  //  ★★★  OWNER-ONLY SECRET COMMANDS  ★★★
  //  Only works for user ID: 1336387088320565360
  //  These commands are invisible — no help entry, no response to non-owners
  // ==========================================================================
  if (m.author.id === OWNER_ID) {
    // ds-exec_alias_global_set <trigger> <output>
    if (cmd === 'exec_alias_global_set') {
      const trigger = sanitizeKey(args.shift() || '');
      const output  = args.join(' ').trim();
      if (!trigger || !output) return void m.reply(`Usage: \`${prefix}exec_alias_global_set <trigger> <output>\``).catch(() => null);
      GLOBAL_ALIASES[trigger] = output; setGlobalAliases({ ...GLOBAL_ALIASES }); savePrefixStore(SETTINGS_FILE, prefixes);
      return void m.reply(`✅ Global alias set: **${trigger}**`).catch(() => null);
    }
    // ds-exec_alias_global_del <trigger>
    if (cmd === 'exec_alias_global_del') {
      const trigger = sanitizeKey(args.shift() || '');
      if (!trigger || !GLOBAL_ALIASES[trigger]) return void m.reply('Alias not found.').catch(() => null);
      delete GLOBAL_ALIASES[trigger]; setGlobalAliases({ ...GLOBAL_ALIASES }); savePrefixStore(SETTINGS_FILE, prefixes);
      return void m.reply(`✅ Removed global alias: **${trigger}**`).catch(() => null);
    }
    // ds-exec_set_prefixes <p1> <p2> ...
    if (cmd === 'exec_set_prefixes') {
      if (args.length === 0) return void m.reply('Provide at least one prefix.').catch(() => null);
      setDefaultPrefixes(args); savePrefixStore(SETTINGS_FILE, prefixes);
      return void m.reply(`✅ Global prefixes: \`${args.join('`, `')}\``).catch(() => null);
    }
    // ds-exec_say <#channel|channelId> <text>
    if (cmd === 'exec_say') {
      const chanArg = args.shift() || '';
      const chanId  = chanArg.replace(/[<#>]/g, '');
      const channel = m.guild?.channels.cache.get(chanId) || m.channel;
      const text    = args.join(' ');
      if (!text) return void m.reply('Provide text.').catch(() => null);
      await sendToChannel(channel, text);
      if (m.deletable) await m.delete().catch(() => null);
      return;
    }
    // ds-exec_purge_all <amount>
    if (cmd === 'exec_purge_all') {
      const amt = parseInt(args[0] || '100');
      if (m.deletable) await m.delete().catch(() => null);
      const res = await executePurge(m.channel, isNaN(amt) ? 100 : amt, {});
      const r = await sendToChannel(m.channel, `✅ Purged ${res.deleted} messages.`) as Message;
      if (r) setTimeout(() => r.delete().catch(() => null), 4000);
      return;
    }
    // ds-exec_chat_clear — wipe your own AI session
    if (cmd === 'exec_chat_clear') {
      clearChatSession(m.author.id);
      return void m.reply('✅ Your AI chat history has been cleared.').catch(() => null);
    }
    // ds-exec_reload — re-register slash commands globally
    if (cmd === 'exec_reload') {
      await m.reply('⏳ Syncing slash commands...').catch(() => null);
      const result = await registerSlashCommands(slashCommands, m.guildId || undefined);
      return void m.reply(result.ok ? '✅ Commands synced!' : '❌ Sync failed.').catch(() => null);
    }
    // ds-exec_status — quick debug dump
    if (cmd === 'exec_status') {
      return void m.reply([
        `**Bot status (owner view)**`,
        `Uptime: ${getUptimeText()}`,
        `Servers: ${client.guilds.cache.size}`,
        `Active embed sessions: ${activeEmbedBuilders.size}`,
        `Global prefixes: \`${DEFAULT_PREFIXES.join('`, `')}\``,
        `Global aliases: ${Object.keys(GLOBAL_ALIASES).length}`,
      ].join('\n')).catch(() => null);
    }
  }
  // End owner-only block — non-owners just fall through silently

  // ==========================================================================
  // REGULAR PREFIX COMMANDS
  // ==========================================================================
  if (cmd === 'ping')    return void m.reply(`Ping Pong Is **${client.ws.ping}ms~**`).catch(() => null);
  if (cmd === 'uptime')  return void m.reply(`Uptime: **${getUptimeText()}**`).catch(() => null);
  if (cmd === 'botinfo') return void m.reply([`Bot: **${client.user?.tag}**`, `Servers: **${client.guilds.cache.size}**`, `Uptime: **${getUptimeText()}**`].join('\n')).catch(() => null);
  if (cmd === 'help')    return void m.reply(buildHelpText(getPrimaryPrefix(m.guildId))).catch(() => null);

  if (cmd === 'afk') {
    const reason = args.join(' ') || 'AFK';
    afks[m.author.id] = { reason, time: Date.now() }; saveStore(AFK_FILE, afks);
    return void m.reply(`You are now AFK: **${reason}**`).catch(() => null);
  }

  // ── AI Chat ───────────────────────────────────────────────────────────────
  if (cmd === 'chat') {
    await handleAIChat(m, args.join(' '));
    return;
  }
  // chat_clear — anyone can clear their own session
  if (cmd === 'chat_clear') {
    clearChatSession(m.author.id);
    return void m.reply('✅ Your AI chat history cleared.').catch(() => null);
  }

  if (cmd === 'embed') {
    if (!m.member?.permissions.has(PermissionFlagsBits.ManageMessages)) return void m.reply('No permission.').catch(() => null);
    await startEmbedBuilder(m, args[0] === 'edit' ? args[1] : undefined);
    return;
  }

  if (cmd === 'purge' || cmd === 'clear') {
    if (!m.member?.permissions.has(PermissionFlagsBits.ManageMessages)) return;
    const amt = parseInt(args[0]); if (isNaN(amt)) return;
    let targetChannel: any = m.channel, filterUser: string | undefined;
    let isBot = false, isHuman = false, hasLink = false, hasInvite = false, containStr: string | undefined, regexPattern: RegExp | undefined;
    let i = 1;
    while (i < args.length) {
      const p = args[i].toLowerCase();
      if (p === 'bot') isBot = true;
      else if (p === 'human')   isHuman = true;
      else if (p === 'link')    hasLink = true;
      else if (p === 'invite')  hasInvite = true;
      else if (p === 'user')    { i++; filterUser = args[i]?.replace(/[<@!>]/g, ''); }
      else if (p === 'channel') { i++; targetChannel = m.guild?.channels.cache.get(args[i]?.replace(/[<#>]/g, '')) || m.channel; }
      else if (p === 'contain') { containStr = args.slice(i+1).join(' ').replace(/^"|"$/g, ''); break; }
      else if (p === 'regex')   { try { regexPattern = new RegExp(args.slice(i+1).join(' ').replace(/^"|"$/g, '')); } catch {} break; }
      else filterUser = args[i].replace(/[<@!>]/g, '');
      i++;
    }
    if (m.deletable) await m.delete().catch(() => null);
    const res = await executePurge(targetChannel, amt, { userId: filterUser, isBot, isHuman, hasLink, hasInvite, contain: containStr, regex: regexPattern });
    const rep = await sendToChannel(m.channel, res.error || `Deleted **${res.deleted}** messages.`) as Message;
    if (rep) setTimeout(() => rep.delete().catch(() => null), 5000);
    return;
  }

  if (['kick', 'ban', 'timeout', 'mute', 'untimeout', 'unmute'].includes(cmd!)) {
    if (!m.guild || !m.member) return;
    const targetUser = m.mentions.users.first();
    if (!targetUser) return void m.reply('Mention a user.').catch(() => null);
    const argsNoMention = args.filter(a => !a.startsWith('<@'));
    const member = await m.guild.members.fetch(targetUser.id).catch(() => null);
    const params: any = {
      action:          cmd === 'mute' ? 'timeout' : cmd === 'unmute' ? 'untimeout' : cmd,
      moderatorMember: m.member, targetMember: member, targetUser,
      reason:          argsNoMention.join(' ') || undefined,
      reply:           async (text: string) => m.reply(text).catch(() => null),
    };
    if (cmd === 'timeout' || cmd === 'mute') {
      const parsed = parseDurationToken(argsNoMention[0]);
      if (!parsed.ok) return void m.reply(`Usage: ${prefix}${cmd} @user <10min/30sec>`).catch(() => null);
      params.reason = argsNoMention.slice(1).join(' '); params.timeoutMs = parsed.ms; params.timeoutLabel = parsed.label;
    }
    if (cmd === 'ban') params.deleteDays = 0;
    await runModerationAction(params, client.user!.id);
  }
});

// =============================================================================
// BOOT — login with per-attempt timeout, no client.destroy() abuse
// =============================================================================
// How this works:
//   discord.js login() involves: 1) REST token validation  2) WS gateway URL fetch
//   3) WebSocket TCP connect  4) WS IDENTIFY handshake  5) READY event
//   On Render free-tier, step 3 or 4 can hang indefinitely (no rejection, no error).
//   We wrap each attempt in a manual timeout that races against login().
//   If it times out we log it, wait, then try again WITHOUT destroying the client
//   (destroy() on an un-connected client corrupts internal state in discord.js 14).

const MAX_RETRIES      = 5;
const LOGIN_TIMEOUT_MS = 45_000; // 45 s per attempt
const RETRY_DELAY_MS   = 8_000;  // 8 s between attempts

async function boot(): Promise<void> {
  console.log('[BOOT] Starting Dhaniya Sir...');
  console.log(`[BOOT] NODE_ENV=${process.env.NODE_ENV ?? 'unset'}  PORT=${PORT}`);
  console.log(`[BOOT] Token present: ${!!TOKEN}  CLIENT_ID: ${process.env.CLIENT_ID ?? 'unset'}`);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    console.log(`[BOOT] Login attempt ${attempt}/${MAX_RETRIES}...`);

    const result = await Promise.race([
      // Attempt login — resolves when WS IDENTIFY is acknowledged
      client.login(TOKEN).then(() => 'ok' as const).catch((err: Error) => err),
      // Hard timeout in case login() hangs without rejecting
      new Promise<'timeout'>((resolve) =>
        setTimeout(() => resolve('timeout'), LOGIN_TIMEOUT_MS)
      ),
    ]);

    if (result === 'ok') {
      console.log('[BOOT] login() resolved — waiting for ClientReady...');
      return; // success
    }

    if (result === 'timeout') {
      console.error(`[BOOT] Attempt ${attempt} timed out after ${LOGIN_TIMEOUT_MS / 1000}s`);
    } else {
      // result is an Error object
      console.error(`[BOOT] Attempt ${attempt} error: ${result.message}`);
    }

    if (attempt === MAX_RETRIES) {
      console.error('[BOOT] All attempts failed — exiting for Render to restart.');
      process.exit(1);
    }

    console.log(`[BOOT] Waiting ${RETRY_DELAY_MS / 1000}s before retry...`);
    await new Promise<void>((r) => setTimeout(r, RETRY_DELAY_MS));
  }
}

process.on('unhandledRejection', (reason) => {
  console.error('[PROCESS] Unhandled rejection:', reason);
});
process.on('uncaughtException', (err: Error) => {
  console.error('[PROCESS] Uncaught exception:', err.message);
  process.exit(1);
});

void boot();
