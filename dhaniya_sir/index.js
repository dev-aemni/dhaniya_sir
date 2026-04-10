require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  PermissionFlagsBits,
  SlashCommandBuilder,
  REST,
  Routes,
  Events
} = require('discord.js');

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const PREFIX = "'";
const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000;

if (!TOKEN) {
  throw new Error('Missing TOKEN in .env');
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent
  ]
});

const slashCommands = [
  new SlashCommandBuilder().setName('ping').setDescription('Check bot latency.'),
  new SlashCommandBuilder().setName('help').setDescription('Show all commands.'),
  new SlashCommandBuilder().setName('guildid').setDescription('Show current server ID.'),
  new SlashCommandBuilder()
    .setName('synccommands')
    .setDescription('Sync slash commands to this server now.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
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
        .setDescription('Delete message history for the last N days (0-7)')
        .setMinValue(0)
        .setMaxValue(7)
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
  new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('Timeout (mute) a member for some minutes.')
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
      option.setName('reason').setDescription('Reason for timeout').setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  new SlashCommandBuilder()
    .setName('mute')
    .setDescription('Alias of /timeout (mute member).')
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
      option.setName('reason').setDescription('Reason for mute').setRequired(false)
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

async function registerSlashCommands(preferredGuildId) {
  if (!CLIENT_ID) {
    console.warn('Skipping slash command registration: CLIENT_ID missing in .env');
    return { ok: false, scope: 'none', reason: 'missing_client_id' };
  }

  const rest = new REST({ version: '10' }).setToken(TOKEN);
  const guildIdToUse = preferredGuildId || GUILD_ID;

  if (guildIdToUse) {
    try {
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID, guildIdToUse), {
        body: slashCommands
      });
      console.log(`Registered slash commands for guild ${guildIdToUse}.`);
      return { ok: true, scope: 'guild', guildId: guildIdToUse };
    } catch (error) {
      console.error(`Guild slash registration failed for ${guildIdToUse}:`, error?.rawError || error);
      if (error?.code !== 50001) {
        return { ok: false, scope: 'guild', guildId: guildIdToUse, reason: error?.code || 'unknown' };
      }
      console.warn('Guild registration failed with Missing Access. Falling back to global commands.');
    }
  }

  try {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: slashCommands });
    console.log('Registered global slash commands. Global propagation can take up to 1 hour.');
    return { ok: true, scope: 'global' };
  } catch (error) {
    console.error('Global slash registration failed:', error?.rawError || error);
    return { ok: false, scope: 'global', reason: error?.code || 'unknown' };
  }
}

function buildHelpText() {
  return [
    `Prefix: ${PREFIX}`,
    '',
    'Prefix Commands:',
    `${PREFIX}ping`,
    `${PREFIX}help`,
    `${PREFIX}guildid`,
    `${PREFIX}synccommands`,
    `${PREFIX}hi`,
    `${PREFIX}dhaniya`,
    `${PREFIX}kick @user [reason]`,
    `${PREFIX}ban @user [reason]`,
    `${PREFIX}timeout @user <10min/30sec/2hour/1day/1week/1mon/1y> [reason]`,
    `${PREFIX}mute @user <10min/30sec/2hour/1day/1week/1mon/1y> [reason]`,
    `${PREFIX}untimeout @user [reason]`,
    `${PREFIX}unmute @user [reason]`,
    '',
    'Slash Commands:',
    '/ping, /help, /guildid, /synccommands, /kick, /ban, /timeout, /mute, /untimeout, /unmute'
  ].join('\n');
}

function formatDurationMs(ms) {
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}sec`;
  if (sec % 60 === 0 && sec < 3600) return `${sec / 60}min`;
  if (sec % 3600 === 0 && sec < 86400) return `${sec / 3600}hour`;
  if (sec % 86400 === 0 && sec < 604800) return `${sec / 86400}day`;
  if (sec % 604800 === 0 && sec < 2592000) return `${sec / 604800}week`;
  return `${sec}sec`;
}

function parseDurationToken(token) {
  if (!token) return null;

  const match = String(token).trim().toLowerCase().match(/^(\d+)([a-z]+)?$/);
  if (!match) return null;

  const amount = Number(match[1]);
  const unit = match[2] || 'min';

  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  const unitMsMap = {
    s: 1000,
    sec: 1000,
    secs: 1000,
    second: 1000,
    seconds: 1000,

    m: 60 * 1000,
    min: 60 * 1000,
    mins: 60 * 1000,
    minute: 60 * 1000,
    minutes: 60 * 1000,

    h: 60 * 60 * 1000,
    hr: 60 * 60 * 1000,
    hrs: 60 * 60 * 1000,
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
    yr: 365 * 24 * 60 * 60 * 1000,
    year: 365 * 24 * 60 * 60 * 1000,
    years: 365 * 24 * 60 * 60 * 1000
  };

  if (!unitMsMap[unit]) {
    return null;
  }

  const ms = amount * unitMsMap[unit];

  if (ms > MAX_TIMEOUT_MS) {
    return {
      ok: false,
      error: 'too_long',
      max: formatDurationMs(MAX_TIMEOUT_MS)
    };
  }

  return {
    ok: true,
    ms,
    label: `${amount}${unit}`
  };
}

async function runModerationAction({
  action,
  moderatorMember,
  targetMember,
  targetUser,
  guild,
  reason,
  timeoutMs,
  timeoutLabel,
  deleteDays,
  reply
}) {
  const moderatorTag = moderatorMember?.user?.tag || 'unknown moderator';
  const safeReason = reason || `No reason provided (by ${moderatorTag})`;

  if (!moderatorMember || !guild) {
    await reply('This command can only be used inside a server.');
    return;
  }

  const botMember = guild.members.me;
  if (!botMember) {
    await reply('Bot member is not ready yet. Try again in a moment.');
    return;
  }

  if (targetUser && targetUser.id === moderatorMember.id) {
    await reply('You cannot moderate yourself.');
    return;
  }

  if (targetUser && targetUser.id === client.user.id) {
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
    if (!targetMember) {
      await reply('User is not in this server.');
      return;
    }
    if (!targetMember.kickable) {
      await reply('I cannot kick that user (role hierarchy or permissions issue).');
      return;
    }

    await targetMember.kick(safeReason);
    await reply(`Kicked **${targetMember.user.tag}**. Reason: ${safeReason}`);
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
    if (!targetMember) {
      await reply('User is not in this server.');
      return;
    }
    if (!targetMember.moderatable) {
      await reply('I cannot timeout that user (role hierarchy or permissions issue).');
      return;
    }

    await targetMember.timeout(timeoutMs, safeReason);
    await reply(`Timed out **${targetMember.user.tag}** for **${timeoutLabel}**. Reason: ${safeReason}`);
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
    if (!targetMember) {
      await reply('User is not in this server.');
      return;
    }
    if (!targetMember.moderatable) {
      await reply('I cannot untimeout that user (role hierarchy or permissions issue).');
      return;
    }

    await targetMember.timeout(null, safeReason);
    await reply(`Removed timeout from **${targetMember.user.tag}**. Reason: ${safeReason}`);
  }
}

client.once(Events.ClientReady, async readyClient => {
  console.log(`Dhaniya Sir is online as ${readyClient.user.tag}!`);
  await registerSlashCommands();
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  try {
    const { commandName } = interaction;

    if (commandName === 'ping') {
      await interaction.reply(`Pong! ${client.ws.ping}ms`);
      return;
    }

    if (commandName === 'help') {
      await interaction.reply({ content: buildHelpText(), ephemeral: true });
      return;
    }

    if (commandName === 'guildid') {
      await interaction.reply({
        content: interaction.guild ? `Guild ID: ${interaction.guild.id}` : 'This is only available inside a server.',
        ephemeral: true
      });
      return;
    }

    if (commandName === 'synccommands') {
      if (!interaction.guild) {
        await interaction.reply({ content: 'Use this command inside a server.', ephemeral: true });
        return;
      }

      await interaction.deferReply({ ephemeral: true });
      const result = await registerSlashCommands(interaction.guild.id);
      if (result.ok) {
        await interaction.editReply(`Slash commands synced for this server (${interaction.guild.id}).`);
      } else {
        await interaction.editReply('Failed to sync slash commands. Check bot permissions and scopes.');
      }
      return;
    }

    if (commandName === 'kick') {
      const user = interaction.options.getUser('user', true);
      const reason = interaction.options.getString('reason') || undefined;
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);

      await runModerationAction({
        action: 'kick',
        moderatorMember: interaction.member,
        targetMember: member,
        targetUser: user,
        guild: interaction.guild,
        reason,
        reply: msg => interaction.reply({ content: msg, ephemeral: true })
      });
      return;
    }

    if (commandName === 'ban') {
      const user = interaction.options.getUser('user', true);
      const reason = interaction.options.getString('reason') || undefined;
      const deleteDays = interaction.options.getInteger('delete_days') || 0;

      await runModerationAction({
        action: 'ban',
        moderatorMember: interaction.member,
        targetUser: user,
        guild: interaction.guild,
        reason,
        deleteDays,
        reply: msg => interaction.reply({ content: msg, ephemeral: true })
      });
      return;
    }

    if (commandName === 'timeout' || commandName === 'mute') {
      const user = interaction.options.getUser('user', true);
      const minutes = interaction.options.getInteger('minutes', true);
      const reason = interaction.options.getString('reason') || undefined;
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);

      await runModerationAction({
        action: 'timeout',
        moderatorMember: interaction.member,
        targetMember: member,
        targetUser: user,
        guild: interaction.guild,
        reason,
        timeoutMs: minutes * 60 * 1000,
        timeoutLabel: `${minutes}min`,
        reply: msg => interaction.reply({ content: msg, ephemeral: true })
      });
      return;
    }

    if (commandName === 'untimeout' || commandName === 'unmute') {
      const user = interaction.options.getUser('user', true);
      const reason = interaction.options.getString('reason') || undefined;
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);

      await runModerationAction({
        action: 'untimeout',
        moderatorMember: interaction.member,
        targetMember: member,
        targetUser: user,
        guild: interaction.guild,
        reason,
        reply: msg => interaction.reply({ content: msg, ephemeral: true })
      });
      return;
    }
  } catch (error) {
    console.error('Interaction error:', error);

    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({
        content: 'Something went wrong while running that command.',
        ephemeral: true
      });
    } else {
      await interaction.reply({
        content: 'Something went wrong while running that command.',
        ephemeral: true
      });
    }
  }
});

client.on('messageCreate', async message => {
  if (message.author.bot) return;

  if (!message.content.startsWith(PREFIX)) {
    if (message.content.toLowerCase() === 'hi') {
      await message.reply('Hello beta');
    }
    return;
  }

  const withoutPrefix = message.content.slice(PREFIX.length).trim();
  if (!withoutPrefix) return;

  const parts = withoutPrefix.split(/\s+/);
  const command = parts.shift().toLowerCase();

  if (command === 'ping') {
    await message.reply(`Pong! ${client.ws.ping}ms`);
    return;
  }

  if (command === 'help') {
    await message.reply(buildHelpText());
    return;
  }

  if (command === 'hi') {
    await message.reply('Hello beta');
    return;
  }

  if (command === 'dhaniya') {
    await message.reply('Main hoon <@1490977175724359801>');
    return;
  }

  if (command === 'guildid') {
    if (!message.guild) {
      await message.reply('Use this in a server channel.');
      return;
    }

    await message.reply(`Guild ID: ${message.guild.id}`);
    return;
  }

  if (command === 'synccommands') {
    if (!message.guild) {
      await message.reply('Use this in a server channel.');
      return;
    }

    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
      await message.reply('You need Administrator permission for this command.');
      return;
    }

    const result = await registerSlashCommands(message.guild.id);
    if (result.ok) {
      await message.reply(`Synced slash commands for this server (${message.guild.id}).`);
    } else {
      await message.reply('Failed to sync slash commands. Check invite scopes and permissions.');
    }
    return;
  }

  if (!message.guild) {
    await message.reply('Moderation prefix commands work only in servers.');
    return;
  }

  const memberMentions = message.mentions.members;
  const userMentions = message.mentions.users;
  const targetMember = memberMentions.first() || null;
  const targetUser = userMentions.first() || null;
  const reasonAndArgs = parts.filter(arg => !arg.startsWith('<@'));

  if (['kick', 'ban', 'timeout', 'mute', 'untimeout', 'unmute'].includes(command) && !targetUser) {
    await message.reply('Please mention a user. Example: `' + command + ' @user ...`');
    return;
  }

  if (command === 'kick') {
    const reason = reasonAndArgs.join(' ') || undefined;

    await runModerationAction({
      action: 'kick',
      moderatorMember: message.member,
      targetMember,
      targetUser,
      guild: message.guild,
      reason,
      reply: msg => message.reply(msg)
    });
    return;
  }

  if (command === 'ban') {
    const reason = reasonAndArgs.join(' ') || undefined;

    await runModerationAction({
      action: 'ban',
      moderatorMember: message.member,
      targetUser,
      guild: message.guild,
      reason,
      deleteDays: 0,
      reply: msg => message.reply(msg)
    });
    return;
  }

  if (command === 'timeout' || command === 'mute') {
    const durationToken = reasonAndArgs[0];
    const parsed = parseDurationToken(durationToken);

    if (!parsed) {
      await message.reply(
        'Usage: `' +
          command +
          ' @user <10min/30sec/2hour/1day/1week/1mon/1y> [reason]`'
      );
      return;
    }

    if (!parsed.ok && parsed.error === 'too_long') {
      await message.reply(
        `Discord timeout max is 28 days. Please use a shorter duration (max ${parsed.max}).`
      );
      return;
    }

    const reason = reasonAndArgs.slice(1).join(' ') || undefined;

    await runModerationAction({
      action: 'timeout',
      moderatorMember: message.member,
      targetMember,
      targetUser,
      guild: message.guild,
      reason,
      timeoutMs: parsed.ms,
      timeoutLabel: parsed.label,
      reply: msg => message.reply(msg)
    });
    return;
  }

  if (command === 'untimeout' || command === 'unmute') {
    const reason = reasonAndArgs.join(' ') || undefined;

    await runModerationAction({
      action: 'untimeout',
      moderatorMember: message.member,
      targetMember,
      targetUser,
      guild: message.guild,
      reason,
      reply: msg => message.reply(msg)
    });
  }
});

client.login(TOKEN);
