const { Client, GatewayIntentBits, PermissionsBitField, SlashCommandBuilder, REST, Routes } = require('discord.js');
require('dotenv').config(); // Load environment variables

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ]
});

let createdChannelID = null; // Define createdChannelID at the global scope
let privateChannels = new Map(); // Map to keep track of private channels and their owners

client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
});

// Define the slash command
const commandData = new SlashCommandBuilder()
    .setName('createvoice')
    .setDescription('Creates a voice channel in the specified category')
    .addStringOption(option =>
        option.setName('category')
            .setDescription('The category ID where the voice channel will be created')
            .setRequired(true)
    );

client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    const { commandName } = interaction;

    if (commandName === 'createvoice') {
        console.log('Create voice command received.');

        // Check if the user has administrator permissions
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            console.log('User does not have administrator permissions.');
            return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
        }

        const categoryID = interaction.options.getString('category');

        if (!categoryID) {
            console.log('No category ID specified.');
            return interaction.reply({ content: 'Please specify a category ID.', ephemeral: true });
        }

        // Check for proper permissions
        if (!interaction.guild.members.me.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
            console.log('Bot does not have permission to manage channels.');
            return interaction.reply({ content: 'I do not have permission to manage channels!', ephemeral: true });
        }

        try {
            // Find the category by ID
            const category = interaction.guild.channels.cache.find(c => c.id === categoryID && c.type === 4); // 4 is for GUILD_CATEGORY
            console.log('Category found:', category);

            if (!category) {
                console.log('Category not found or invalid ID.');
                return interaction.reply({ content: 'Category not found or the ID is invalid.', ephemeral: true });
            }

            // Create a new voice channel under the specified category
            const voiceChannel = await interaction.guild.channels.create({
                name: 'Join to create your own channel',
                type: 2, // 2 is for GUILD_VOICE channel type
                parent: category,
                reason: 'Needed a new voice channel'
            });

            createdChannelID = voiceChannel.id; // Store the created channel ID
            console.log('Created channel ID:', createdChannelID);

            interaction.reply({ content: `Created new voice channel: ${voiceChannel.name} in category: ${category.name}`, ephemeral: true });
        } catch (error) {
            console.error('Error creating voice channel:', error);
            interaction.reply({ content: 'There was an error creating the voice channel.', ephemeral: true });
        }
    }
});

client.on('voiceStateUpdate', async (oldState, newState) => {
    console.log('Voice state update detected.');
    console.log('oldState channel:', oldState.channel ? oldState.channel.id : 'null');
    console.log('newState channel:', newState.channel ? newState.channel.id : 'null');
    console.log('createdChannelID:', createdChannelID);

    // Check if a user has joined the specific voice channel created
    if (!oldState.channel && newState.channel && newState.channel.id === createdChannelID && !privateChannels.has(newState.member.id)) {
        console.log(`${newState.member.user.tag} joined ${newState.channel.name}`);

        try {
            // Get the user's name
            const userName = newState.member.user.username;
            const userId = newState.member.id;
            console.log('User who joined:', userName);

            // Get the @everyone role and the Member role
            const everyoneRole = newState.guild.roles.everyone;
            const memberRole = newState.guild.roles.cache.find(role => role.name === 'Member');

            if (!everyoneRole) {
                console.error('Could not find @everyone role.');
                return;
            }

            if (!memberRole) {
                console.error('Could not find Member role.');
                return;
            }

            console.log('Roles found:', everyoneRole.name, memberRole.name);

            // Create two new voice channels in the same category
            const category = newState.channel.parent;
            console.log('Category for new channels:', category.name);

            const privateChannel = await newState.guild.channels.create({
                name: `${userName}'s private channel`,
                type: 2, // 2 is for GUILD_VOICE channel type
                parent: category,
                reason: `User ${userName} joined the initial created channel`,
                permissionOverwrites: [
                    {
                        id: everyoneRole.id,
                        deny: [PermissionsBitField.Flags.ViewChannel]
                    },
                    {
                        id: userId, // Give the user permissions
                        allow: [
                            PermissionsBitField.Flags.ViewChannel,
                            PermissionsBitField.Flags.Connect,
                            PermissionsBitField.Flags.Speak,
                            PermissionsBitField.Flags.MoveMembers
                        ]
                    }
                ]
            });

            const moveChannel = await newState.guild.channels.create({
                name: `${userName}'s join to be moved`,
                type: 2, // 2 is for GUILD_VOICE channel type
                parent: category,
                reason: `User ${userName} joined the initial created channel`,
                permissionOverwrites: [
                    {
                        id: everyoneRole.id,
                        deny: [PermissionsBitField.Flags.ViewChannel]
                    },
                    {
                        id: memberRole.id, // Allow the member role to view but not speak
                        allow: [PermissionsBitField.Flags.ViewChannel],
                        deny: [PermissionsBitField.Flags.Speak]
                    },
                    {
                        id: userId, // Allow the user to move members
                        allow: [
                            PermissionsBitField.Flags.ViewChannel,
                            PermissionsBitField.Flags.Connect,
                            PermissionsBitField.Flags.Speak,
                            PermissionsBitField.Flags.MoveMembers
                        ]
                    }
                ]
            });

            console.log(`Created additional voice channels: ${privateChannel.name} and ${moveChannel.name}`);

            // Move the user to their private channel
            await newState.member.voice.setChannel(privateChannel);
            console.log(`Moved ${userName} to their private channel: ${privateChannel.name}`);

            // Store the private and move channels with the user ID as key
            privateChannels.set(newState.member.id, { privateChannel: privateChannel.id, moveChannel: moveChannel.id });
        } catch (error) {
            console.error('Error creating additional voice channels:', error);
        }
    }

    // Check if the user left the private or move channel and delete the channels if they are the owner
    if (
        oldState.channel &&
        privateChannels.has(oldState.member.id) &&
        oldState.channel.id !== newState.channel.id &&
        (!newState.channel || newState.channel.id !== privateChannels.get(oldState.member.id).privateChannel)
    ) {
        const channels = privateChannels.get(oldState.member.id);
        if (oldState.channel.id === channels.privateChannel || oldState.channel.id === channels.moveChannel) {
            try {
                const privateChannel = oldState.guild.channels.cache.get(channels.privateChannel);
                const moveChannel = oldState.guild.channels.cache.get(channels.moveChannel);

                if (privateChannel) {
                    await privateChannel.delete();
                    console.log(`Deleted private channel: ${privateChannel.name}`);
                }

                if (moveChannel) {
                    await moveChannel.delete();
                    console.log(`Deleted move channel: ${moveChannel.name}`);
                }

                // Remove the entry from the map
                privateChannels.delete(oldState.member.id);
            } catch (error) {
                console.error('Error deleting channels:', error);
            }
        }
    }
});

client.login(process.env.TOKEN);

// Register the slash command
const commands = [
    new SlashCommandBuilder()
        .setName('createvoice')
        .setDescription('Creates a voice channel in the specified category')
        .addStringOption(option => 
            option.setName('category')
            .setDescription('The category ID where the voice channel will be created')
            .setRequired(true)
        ),
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

(async () => {
    try {
        console.log('Started refreshing application (/) commands.');

        await rest.put(
            Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
            { body: commands },
        );

        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error(error);
    }
})();
