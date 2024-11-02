require('dotenv').config();

const { Client, GatewayIntentBits, SlashCommandBuilder, Routes, EmbedBuilder, ActivityType } = require('discord.js');
const { REST } = require('@discordjs/rest');
const { joinVoiceChannel, EndBehaviorType, getVoiceConnection } = require('@discordjs/voice');
const prism = require('prism-media');
const fs = require('fs');
const path = require('path');
const configPath = path.join(__dirname, 'config.json');
const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

function loadConfig() {
    if (!fs.existsSync(configPath)) {
        const defaultConfig = {
            guilds: {}
        };
        fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 4));
        return defaultConfig;
    }
    const data = fs.readFileSync(configPath);
    let config = JSON.parse(data);

    if (!config.guilds) {
        config.guilds = {};
        saveConfig(config);
    }
    return config;
}

function saveConfig(config) {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 4));
}

function getDecibelThreshold(guildId) {
    if (config.guilds && config.guilds[guildId] && typeof config.guilds[guildId].decibelThreshold === 'number') {
        return config.guilds[guildId].decibelThreshold;
    }
    return 70; // デフォルトdb値
}

function setDecibelThreshold(guildId, value) {
    if (!config.guilds[guildId]) {
        config.guilds[guildId] = {};
    }
    config.guilds[guildId].decibelThreshold = value;
    saveConfig(config);
}

let config = loadConfig();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
    ],
});

const commands = [
    new SlashCommandBuilder()
        .setName('vcpolice')
        .setDescription('ボイスチャンネルに接続して監視を開始します。')
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('監視するボイスチャンネルを指定します。')
                .setRequired(false)),
    new SlashCommandBuilder()
        .setName('dcpolice')
        .setDescription('ボイスチャンネルから切断します。'),
    new SlashCommandBuilder()
        .setName('setdb')
        .setDescription('デシベルの閾値を設定します。')
        .addIntegerOption(option =>
            option.setName('value')
                .setDescription('設定するデシベル値')
                .setRequired(true)),
]
    .map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
    try {
        console.log('スラッシュコマンドを登録中...');
        await rest.put(
            Routes.applicationCommands(CLIENT_ID),
            { body: commands },
        );
        console.log('スラッシュコマンドの登録に成功しました');
    } catch (error) {
        console.error('スラッシュコマンドの登録中にエラーが発生しました:', error);
    }
})();

function calculateDecibels(audioBuffer) {
    let sumSquares = 0;
    const sampleCount = audioBuffer.length / 2;
    for (let i = 0; i < audioBuffer.length; i += 2) {
        const sample = audioBuffer.readInt16LE(i);
        sumSquares += sample * sample;
    }
    const rms = Math.sqrt(sumSquares / sampleCount);
    if (rms === 0) return 0;
    const decibels = -20 * Math.log10(rms / 32768);
    return decibels;
}

const monitoringSessions = new Map();
const userStreams = new Map();

client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    const { commandName } = interaction;

    const embed = new EmbedBuilder()
        .setColor(0x0099FF)
        .setTimestamp();

    if (commandName === 'vcpolice') {
        let channel = interaction.options.getChannel('channel');
        if (!channel) {
            const member = interaction.member;
            if (!member.voice.channel) {
                embed.setTitle('エラー')
                     .setDescription('ボイスチャンネルに接続するか、チャンネルを指定してください。');
                return interaction.reply({ embeds: [embed], ephemeral: true });
            }
            channel = member.voice.channel;
        }

        const connection = joinVoiceChannel({
            channelId: channel.id,
            guildId: channel.guild.id,
            adapterCreator: channel.guild.voiceAdapterCreator,
            selfDeaf: false,
            selfMute: true,
        });

        console.log(`ボイスチャンネルに接続しました: ${channel.name}`);

        const receiver = connection.receiver;

        if (!userStreams.has(interaction.guild.id)) {
            userStreams.set(interaction.guild.id, new Map());
        }
        const guildUserStreams = userStreams.get(interaction.guild.id);

        receiver.speaking.on('start', userId => {
            if (guildUserStreams.has(userId)) return;

            const opusStream = receiver.subscribe(userId, {
                end: {
                    behavior: EndBehaviorType.Manual,
                },
            });

            const decoder = new prism.opus.Decoder({ frameSize: 960, channels: 2, rate: 48000 });
            opusStream.pipe(decoder);

            const buffer = [];

            decoder.on('data', (pcmData) => {
                buffer.push(pcmData);

                if (buffer.length >= 10) {
                    const combinedBuffer = Buffer.concat(buffer);
                    buffer.length = 0;

                    const decibels = calculateDecibels(combinedBuffer);
                    console.log(`ユーザーID: ${userId}, デシベル: ${decibels}`);

                    if (decibels > getDecibelThreshold(interaction.guild.id)) {
                        const member = interaction.guild.members.cache.get(userId);
                        if (member) {
                            member.voice.disconnect();

                            const notifyEmbed = new EmbedBuilder()
                                .setTitle('ユーザー切断')
                                .setDescription(`<@${member.user.id}> が ${getDecibelThreshold(interaction.guild.id)} dB を超えたため切断されました。`)
                                .setColor(0xFF0000)
                                .setTimestamp();

                            interaction.channel.send({ embeds: [notifyEmbed] });
                        }
                        opusStream.destroy();
                        guildUserStreams.delete(userId);
                    }
                }
            });

            decoder.on('end', () => {
                console.log(`デコーダストリームが終了しました (ユーザーID: ${userId})`);
                guildUserStreams.delete(userId);
            });

            decoder.on('error', (error) => {
                console.error(`デコーダストリームエラー (ユーザーID: ${userId}):`, error);
                guildUserStreams.delete(userId);
            });

            opusStream.on('error', error => {
                console.error(`Opusストリームエラー (ユーザーID: ${userId}):`, error);
                guildUserStreams.delete(userId);
            });

            opusStream.on('close', () => {
                console.log(`Opusストリームがクローズされました (ユーザーID: ${userId})`);
                guildUserStreams.delete(userId);
            });

            guildUserStreams.set(userId, opusStream);
        });

        monitoringSessions.set(interaction.guild.id, connection);

        embed.setTitle('起動')
             .setDescription(`<#${channel.id}>での監視を開始しました！`);
        await interaction.reply({ embeds: [embed] });
    }

    else if (commandName === 'dcpolice') {
        const connection = getVoiceConnection(interaction.guild.id);
        if (connection) {
            if (userStreams.has(interaction.guild.id)) {
                const guildUserStreams = userStreams.get(interaction.guild.id);
                for (const [userId, stream] of guildUserStreams.entries()) {
                    stream.destroy();
                    console.log(`ユーザーストリームを破棄しました (ユーザーID: ${userId})`);
                }
                userStreams.delete(interaction.guild.id);
            }

            connection.destroy();
            monitoringSessions.delete(interaction.guild.id);

            embed.setTitle('停止')
                 .setDescription('ボイスチャンネルから切断しました。');
            await interaction.reply({ embeds: [embed] });
        } else {
            embed.setTitle('エラー')
                 .setDescription('現在、どのボイスチャンネルにも接続されていません。');
            await interaction.reply({ embeds: [embed], ephemeral: true });
        }
    }

    else if (commandName === 'setdb') {
        const value = interaction.options.getInteger('value');
        if (value < 0 || value > 150) {
            embed.setTitle('エラー')
                 .setDescription('デシベル値は0から150の範囲で設定してください。');
            return interaction.reply({ embeds: [embed], ephemeral: true });
        }

        const guildId = interaction.guild.id;
        setDecibelThreshold(guildId, value);

        embed.setTitle('デシベル値の更新')
             .setDescription(`デシベル閾値が **${value}** dB に設定されました。`);
        await interaction.reply({ embeds: [embed] });
    }
});

client.once('ready', () => {
    console.log(`${client.user.tag} としてログインしました`);
    client.user.setActivity({ name:'ボイスチャンネル', type: ActivityType.Competing })
});


client.login(TOKEN);

process.on('unhandledRejection', error => {
    console.error('未処理のプロミス拒否:', error);
});

process.on('uncaughtException', error => {
    console.error('未処理の例外:', error);
    process.exit(1);
});
