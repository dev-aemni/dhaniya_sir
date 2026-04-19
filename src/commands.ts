import { SlashCommandBuilder, ChannelType, PermissionFlagsBits } from 'discord.js';

export const slashCommands = [
  new SlashCommandBuilder().setName('ping').setDescription('Check bot latency.'),
  new SlashCommandBuilder().setName('uptime').setDescription('Show bot uptime.'),
  new SlashCommandBuilder().setName('help').setDescription('Show all commands.'),
  new SlashCommandBuilder().setName('guildid').setDescription('Show current server ID.'),
  new SlashCommandBuilder().setName('botinfo').setDescription('Show bot info.'),
  new SlashCommandBuilder()
    .setName('afk')
    .setDescription('Set your AFK status.')
    .addStringOption(o => o.setName('reason').setDescription('Reason for AFK')),
  new SlashCommandBuilder()
    .setName('choose')
    .setDescription('Choose one option from multiple choices.')
    .addStringOption(o => o.setName('options').setDescription('Example: tea, coffee, juice').setRequired(true)),
  new SlashCommandBuilder()
    .setName('roll')
    .setDescription('Roll a dice.')
    .addIntegerOption(o => o.setName('sides').setDescription('Dice sides (2-1000)').setMinValue(2).setMaxValue(1000)),
  new SlashCommandBuilder().setName('coinflip').setDescription('Flip a coin.'),
  new SlashCommandBuilder()
    .setName('8ball')
    .setDescription('Ask the magic 8-ball.')
    .addStringOption(o => o.setName('question').setDescription('Your question').setRequired(true)),
  new SlashCommandBuilder()
    .setName('reverse')
    .setDescription('Reverse a text.')
    .addStringOption(o => o.setName('text').setDescription('Text to reverse').setRequired(true)),
  new SlashCommandBuilder()
    .setName('calc')
    .setDescription('Basic calculator (+ - * / and parentheses).')
    .addStringOption(o => o.setName('expression').setDescription('Example: (20+5)*3').setRequired(true)),
  new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Create a giveaway (opens a form).')
    .addChannelOption(o => o.setName('channel').setDescription('Channel where giveaway will be posted').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName('avatar')
    .setDescription('Show user avatar.')
    .addUserOption(o => o.setName('user').setDescription('Target user')),
  new SlashCommandBuilder()
    .setName('userinfo')
    .setDescription('Show user info.')
    .addUserOption(o => o.setName('user').setDescription('Target user')),
  new SlashCommandBuilder().setName('serverinfo').setDescription('Show server info.'),
  new SlashCommandBuilder()
    .setName('role')
    .setDescription('Manage server roles.')
    .addSubcommand(s => s.setName('add').setDescription('Add role to user').addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true)).addRoleOption(o => o.setName('role').setDescription('Target role').setRequired(true)))
    .addSubcommand(s => s.setName('rem').setDescription('Remove role from user').addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true)).addRoleOption(o => o.setName('role').setDescription('Target role').setRequired(true)))
    .addSubcommand(s => s.setName('ren').setDescription('Rename a role').addRoleOption(o => o.setName('role').setDescription('Target role').setRequired(true)).addStringOption(o => o.setName('name').setDescription('New role name').setRequired(true)))
    .addSubcommand(s => s.setName('create').setDescription('Create a role').addStringOption(o => o.setName('name').setDescription('Role name').setRequired(true)))
    .addSubcommand(s => s.setName('del').setDescription('Delete a role').addRoleOption(o => o.setName('role').setDescription('Target role').setRequired(true)))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
  new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Delete multiple messages with advanced filters.')
    .addIntegerOption(opt => opt.setName('amount').setDescription('Number of messages to scan (1-100)').setRequired(true).setMinValue(1).setMaxValue(100))
    .addUserOption(opt => opt.setName('user').setDescription('Filter by specific user'))
    .addChannelOption(opt => opt.setName('channel').setDescription('Target channel').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
    .addStringOption(opt => opt.setName('filter').setDescription('Special message filters').addChoices({ name: 'Bots only', value: 'bot' }, { name: 'Humans only', value: 'human' }, { name: 'Contains Links', value: 'link' }, { name: 'Contains Invites', value: 'invite' }))
    .addStringOption(opt => opt.setName('contain').setDescription('Filter messages containing a specific word/phrase'))
    .addStringOption(opt => opt.setName('regex').setDescription('Filter messages by Regular Expression'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
  new SlashCommandBuilder()
    .setName('delete')
    .setDescription('Fun fake command')
    .addSubcommand(sub => sub.setName('server').setDescription('Fake delete server command').addStringOption(o => o.setName('anything').setDescription('Anything you write will be ignored'))),
  new SlashCommandBuilder().setName('synccommands').setDescription('Sync slash commands to this server now.').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName('prefix')
    .setDescription('Manage server prefix')
    .addSubcommand(s => s.setName('add').setDescription('Set a custom prefix').addStringOption(o => o.setName('value').setDescription('New prefix (1-5 chars)').setRequired(true)))
    .addSubcommand(s => s.setName('remove').setDescription('Reset prefix to default'))
    .addSubcommand(s => s.setName('list').setDescription('Show current server prefix'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName('say')
    .setDescription('Make the bot send text.')
    .addStringOption(o => o.setName('text').setDescription('Text to send').setRequired(true))
    .addChannelOption(o => o.setName('channel').setDescription('Channel to send message in').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
  new SlashCommandBuilder()
    .setName('embed')
    .setDescription('Interactive Embed Builder.')
    .addStringOption(opt => opt.setName('message_id').setDescription('ID of message to edit (optional)'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
  new SlashCommandBuilder().setName('tagscript').setDescription('Quickly show a tag by name.').addStringOption(o => o.setName('name').setDescription('Tag name').setRequired(true)),
  new SlashCommandBuilder()
    .setName('alias')
    .setDescription('Create/update a trigger alias.')
    .addStringOption(o => o.setName('trigger').setDescription('Trigger text, ex: hi').setRequired(true))
    .addStringOption(o => o.setName('output').setDescription('Bot reply text when trigger matches').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName('aliasdel').setDescription('Delete a trigger alias.').addStringOption(o => o.setName('trigger').setDescription('Trigger text to remove').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName('aliases').setDescription('List all aliases.').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName('tag')
    .setDescription('Tag system')
    .addSubcommand(s => s.setName('create').setDescription('Create tag via modal window').addStringOption(o => o.setName('name').setDescription('Tag name').setRequired(true)))
    .addSubcommand(s => s.setName('view').setDescription('View a tag').addStringOption(o => o.setName('name').setDescription('Tag name').setRequired(true)))
    .addSubcommand(s => s.setName('list').setDescription('List all tags'))
    .addSubcommand(s => s.setName('delete').setDescription('Delete a tag').addStringOption(o => o.setName('name').setDescription('Tag name').setRequired(true))),
  new SlashCommandBuilder()
    .setName('chat')
    .setDescription('Chat with Dhaniya Sir AI')
    .addStringOption(o => o.setName('message').setDescription('Your message to the AI').setRequired(true)),
  new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a member.')
    .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason for kicking'))
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),
  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a member.')
    .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason for banning'))
    .addIntegerOption(o => o.setName('delete_days').setDescription('Days of messages to delete').setMinValue(0).setMaxValue(7))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
  new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('Timeout member in minutes.')
    .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true))
    .addIntegerOption(o => o.setName('minutes').setDescription('Minutes to timeout').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason for timeout'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  new SlashCommandBuilder()
    .setName('mute')
    .setDescription('Alias of /timeout.')
    .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true))
    .addIntegerOption(o => o.setName('minutes').setDescription('Minutes to mute').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason for mute'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  new SlashCommandBuilder()
    .setName('untimeout')
    .setDescription('Remove timeout from a member.')
    .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason for untimeout'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  new SlashCommandBuilder()
    .setName('unmute')
    .setDescription('Alias of /untimeout.')
    .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason for unmute'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
].map(command => command.toJSON());