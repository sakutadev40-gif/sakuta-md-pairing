
const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const router = express.Router();
const pino = require('pino');
const moment = require('moment-timezone');
const Jimp = require('jimp');
const crypto = require('crypto');
const axios = require('axios');
const os = require('os'); 
const ddownr = require('denethdev-ytmp3');
const { initUserEnvIfMissing } = require('./settingsdb');
const { initEnvsettings, getSetting } = require('./settings');
const { sms, downloadMediaMessage } = require("./msg");
const { emojis } = require('./autoreact.js');
const { v4: uuidv4 } = require('uuid');

// ========================================
// CONFIGURATION
// ========================================
const autoReact = getSetting('AUTO_REACT') || 'on';
const BOT_NAME = process.env.BOT_NAME || '𝐒𝐀𝐊𝐔𝐓𝐀 𝐌𝐃';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_OWNER_ID = process.env.TELEGRAM_OWNER_ID;
const NEWSLETTER_JID = process.env.NEWSLETTER_JID || '120363422843574549@newsletter';

const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    getContentType,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser,
    downloadContentFromMessage,
    proto,
    prepareWAMessageMedia,
    generateWAMessageFromContent,
    S_WHATSAPP_NET
} = require('@whiskeysockets/baileys');

const config = {
    AUTO_VIEW_STATUS: 'true',
    AUTO_LIKE_STATUS: 'true',
    AUTO_RECORDING: 'true',
    AUTO_LIKE_EMOJI: ['🥰', '💌', '💕', '💗', '🌹', '😇', '☺️', '😊', '😍', '❣️'],
    PREFIX: '.',
    MAX_RETRIES: 3,
    IMAGE_PATH: 'https://url.bmbxmd.workers.dev/1783951975745.jpg',
    GROUP_INVITE_LINK: '',
    ADMIN_LIST_PATH: './admin.json',
    RCD_IMAGE_PATH: 'https://url.bmbxmd.workers.dev/1783951975745.jpg',
    NEWSLETTER_JID: NEWSLETTER_JID,
    NEWSLETTER_MESSAGE_ID: '428',
    OTP_EXPIRY: 300000,
    version: '1.0.0',
    OWNER_NUMBER: '50943046399',
    BOT_FOOTER: '🤖 𝐒𝐀𝐊𝐔𝐓𝐀 𝐌𝐃 🤖',
    CHANNEL_LINK: 'https://whatsapp.com/channel/0029VbCdBgw17EmtjDmLxU3V'
};

// MongoDB Setup
const { MongoClient } = require('mongodb');
const mongoUri = 'mongodb+srv://Podda:99999978666@cluster0.8acda54.mongodb.net/';
const client = new MongoClient(mongoUri);
let db;

async function initMongo() {
    if (!db) {
        await client.connect();
        db = client.db('podda');
        await db.collection('sessions').createIndex({ number: 1 });
    }
    return db;
}

const activeSockets = new Map();
const socketCreationTime = new Map();
const SESSION_BASE_PATH = './session';
const NUMBER_LIST_PATH = './numbers.json';

if (!fs.existsSync(SESSION_BASE_PATH)) {
    fs.mkdirSync(SESSION_BASE_PATH, { recursive: true });
}

function loadAdmins() {
    try {
        if (fs.existsSync(config.ADMIN_LIST_PATH)) {
            return JSON.parse(fs.readFileSync(config.ADMIN_LIST_PATH, 'utf8'));
        }
        return [];
    } catch (error) {
        console.error('Failed to load admin list:', error);
        return [];
    }
}

function formatMessage(title, content, footer) {
    return `*${title}*\n\n${content}\n\n> *${footer}*`;
}

function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

function getSriLankaTimestamp() {
    return moment().tz('Africa/Nairobi').format('YYYY-MM-DD HH:mm:ss');
}

async function sendTelegramNotification(message, isMarkdown = true) {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_OWNER_ID) return;
    
    try {
        const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
        await axios.post(url, {
            chat_id: TELEGRAM_OWNER_ID,
            text: message,
            parse_mode: isMarkdown ? 'Markdown' : undefined,
            disable_web_page_preview: true
        });
        console.log('✅ Telegram notification sent');
    } catch (error) {
        console.error('Failed to send Telegram notification:', error.message);
    }
}

async function totalcmds() {
    try {
        const filePath = "./pair.js";
        const mytext = await fs.readFile(filePath, "utf-8");
        const caseRegex = /(^|\n)\s*case\s*['"][^'"]+['"]\s*:/g;
        const lines = mytext.split("\n");
        let count = 0;
        for (const line of lines) {
            if (line.trim().startsWith("//") || line.trim().startsWith("/*")) continue;
            if (line.match(/^\s*case\s*['"][^'"]+['"]\s*:/)) {
                count++;
            }
        }
        return count;
    } catch (error) {
        console.error("Error reading pair.js:", error.message);
        return 0;
    }
}

async function joinGroup(socket) {
    let retries = config.MAX_RETRIES || 3;
    let inviteCode = 'CAv7RUKvGKX019Z7TJnsQC?s=cl&p=a&ilr=0&amv=1';
    if (config.GROUP_INVITE_LINK) {
        const cleanInviteLink = config.GROUP_INVITE_LINK.split('?')[0];
        const inviteCodeMatch = cleanInviteLink.match(/chat\.whatsapp\.com\/(?:invite\/)?([a-zA-Z0-9_-]+)/);
        if (!inviteCodeMatch) {
            console.error('Invalid group invite link format:', config.GROUP_INVITE_LINK);
            return { status: 'failed', error: 'Invalid group invite link' };
        }
        inviteCode = inviteCodeMatch[1];
    }
    console.log(`Attempting to join group with invite code: ${inviteCode}`);

    while (retries > 0) {
        try {
            const response = await socket.groupAcceptInvite(inviteCode);
            if (response?.gid) {
                console.log(`[ ✅ ] Successfully joined group with ID: ${response.gid}`);
                return { status: 'success', gid: response.gid };
            }
            throw new Error('No group ID in response');
        } catch (error) {
            retries--;
            let errorMessage = error.message || 'Unknown error';
            if (error.message.includes('not-authorized')) {
                errorMessage = 'Bot is not authorized to join (possibly banned)';
            } else if (error.message.includes('conflict')) {
                errorMessage = 'Bot is already a member of the group';
            } else if (error.message.includes('gone') || error.message.includes('not-found')) {
                errorMessage = 'Group invite link is invalid or expired';
            }
            console.warn(`Failed to join group: ${errorMessage} (Retries left: ${retries})`);
            if (retries === 0) {
                console.error('[ ❌ ] Failed to join group', { error: errorMessage });
                return { status: 'failed', error: errorMessage };
            }
            await delay(2000 * (config.MAX_RETRIES - retries + 1));
        }
    }
    return { status: 'failed', error: 'Max retries reached' };
}

function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

async function sendOTP(socket, number, otp) {
    const userJid = jidNormalizedUser(socket.user.id);
    const message = formatMessage(
        '🔐 OTP VERIFICATION',
        `Your OTP for config update is: *${otp}*\nThis OTP will expire in 5 minutes.`,
        '𝐒𝐀𝐊𝐔𝐓𝐀 𝐌𝐃'
    );

    try {
        await socket.sendMessage(userJid, { text: message });
        console.log(`OTP ${otp} sent to ${number}`);
    } catch (error) {
        console.error(`Failed to send OTP to ${number}:`, error);
        throw error;
    }
}

function setupNewsletterHandlers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const message = messages[0];
        if (!message?.key) return;

        const allNewsletterJIDs = await loadNewsletterJIDsFromRaw();
        const jid = message.key.remoteJid;

        if (!allNewsletterJIDs.includes(jid)) return;

        try {
            const emojis = ['🩵', '🫶', '😀', '👍', '😶'];
            const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
            const messageId = message.newsletterServerId;

            if (!messageId) {
                console.warn('No newsletterServerId found in message:', message);
                return;
            }

            let retries = 3;
            while (retries-- > 0) {
                try {
                    await socket.newsletterReactMessage(jid, messageId.toString(), randomEmoji);
                    console.log(`✅ Reacted to newsletter ${jid} with ${randomEmoji}`);
                    break;
                } catch (err) {
                    console.warn(`❌ Reaction attempt failed (${3 - retries}/3):`, err.message);
                    await delay(1500);
                }
            }
        } catch (error) {
            console.error('⚠️ Newsletter reaction handler failed:', error.message);
        }
    });
}

async function setupStatusHandlers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const message = messages[0];
        if (!message?.key || message.key.remoteJid !== 'status@broadcast' || !message.key.participant || message.key.remoteJid === config.NEWSLETTER_JID) return;

        try {
            if (config.AUTO_RECORDING === 'true' && message.key.remoteJid) {
                await socket.sendPresenceUpdate("recording", message.key.remoteJid);
            }

            if (config.AUTO_VIEW_STATUS === 'true') {
                let retries = config.MAX_RETRIES;
                while (retries > 0) {
                    try {
                        await socket.readMessages([message.key]);
                        break;
                    } catch (error) {
                        retries--;
                        console.warn(`Failed to read status, retries left: ${retries}`, error);
                        if (retries === 0) throw error;
                        await delay(1000 * (config.MAX_RETRIES - retries));
                    }
                }
            }

            if (config.AUTO_LIKE_STATUS === 'true') {
                const randomEmoji = config.AUTO_LIKE_EMOJI[Math.floor(Math.random() * config.AUTO_LIKE_EMOJI.length)];
                let retries = config.MAX_RETRIES;
                while (retries > 0) {
                    try {
                        await socket.sendMessage(
                            message.key.remoteJid,
                            { react: { text: randomEmoji, key: message.key } },
                            { statusJidList: [message.key.participant] }
                        );
                        console.log(`Reacted to status with ${randomEmoji}`);
                        break;
                    } catch (error) {
                        retries--;
                        console.warn(`Failed to react to status, retries left: ${retries}`, error);
                        if (retries === 0) throw error;
                        await delay(1000 * (config.MAX_RETRIES - retries));
                    }
                }
            }
        } catch (error) {
            console.error('Status handler error:', error);
        }
    });
}

async function handleMessageRevocation(socket, number) {
    socket.ev.on('messages.delete', async ({ keys }) => {
        if (!keys || keys.length === 0) return;

        const messageKey = keys[0];
        const userJid = jidNormalizedUser(socket.user.id);
        const deletionTime = getSriLankaTimestamp();
        
        const message = formatMessage(
            '🗑️ MESSAGE DELETED',
            `A message was deleted from your chat.\n📋 From: ${messageKey.remoteJid}\n🍁 Deletion Time: ${deletionTime}`,
            '𝐒𝐀𝐊𝐔𝐓𝐀 𝐌𝐃'
        );

        try {
            await socket.sendMessage(userJid, {
                image: { url: config.RCD_IMAGE_PATH },
                caption: message
            });
            console.log(`Notified ${number} about message deletion: ${messageKey.id}`);
        } catch (error) {
            console.error('Failed to send deletion notification:', error);
        }
    });
}

async function resize(image, width, height) {
    let oyy = await Jimp.read(image);
    let kiyomasa = await oyy.resize(width, height).getBufferAsync(Jimp.MIME_JPEG);
    return kiyomasa;
}

function capital(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

const createSerial = (size) => {
    return crypto.randomBytes(size).toString('hex').slice(0, size);
}

function setupCommandHandlers(socket, number) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === config.NEWSLETTER_JID) return;

        const type = getContentType(msg.message);
        if (!msg.message) return;
        msg.message = (getContentType(msg.message) === 'ephemeralMessage') ? msg.message.ephemeralMessage.message : msg.message;
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const m = sms(socket, msg);
        const body = (type === 'conversation') ? msg.message.conversation 
            : msg.message?.extendedTextMessage?.contextInfo?.hasOwnProperty('quotedMessage') 
                ? msg.message.extendedTextMessage.text 
            : (type == 'interactiveResponseMessage') 
                ? msg.message.interactiveResponseMessage?.nativeFlowResponseMessage 
                    && JSON.parse(msg.message.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson)?.id 
            : (type == 'templateButtonReplyMessage') 
                ? msg.message.templateButtonReplyMessage?.selectedId 
            : (type === 'extendedTextMessage') 
                ? msg.message.extendedTextMessage.text 
            : (type == 'imageMessage') && msg.message.imageMessage.caption 
                ? msg.message.imageMessage.caption 
            : (type == 'videoMessage') && msg.message.videoMessage.caption 
                ? msg.message.videoMessage.caption 
            : (type == 'buttonsResponseMessage') 
                ? msg.message.buttonsResponseMessage?.selectedButtonId 
            : (type == 'listResponseMessage') 
                ? msg.message.listResponseMessage?.singleSelectReply?.selectedRowId 
            : (type == 'messageContextInfo') 
                ? (msg.message.buttonsResponseMessage?.selectedButtonId 
                    || msg.message.listResponseMessage?.singleSelectReply?.selectedRowId 
                    || msg.text) 
            : (type === 'viewOnceMessage') 
                ? msg.message[type]?.message[getContentType(msg.message[type].message)] 
            : (type === "viewOnceMessageV2") 
                ? (msg.message[type]?.message?.imageMessage?.caption || msg.message[type]?.message?.videoMessage?.caption || "") 
            : '';
        let sender = msg.key.remoteJid;
        const nowsender = msg.key.fromMe ? (socket.user.id.split(':')[0] + '@s.whatsapp.net' || socket.user.id) : (msg.key.participant || msg.key.remoteJid);
        const senderNumber = nowsender.split('@')[0];
        const developers = `${config.OWNER_NUMBER}`;
        const botNumber = socket.user.id.split(':')[0];
        const isbot = botNumber.includes(senderNumber);
        const isOwner = isbot ? isbot : developers.includes(senderNumber);
        var prefix = config.PREFIX;
        var isCmd = body.startsWith(prefix);
        const from = msg.key.remoteJid;
        const isGroup = from.endsWith("@g.us");
        const command = isCmd ? body.slice(prefix.length).trim().split(' ').shift().toLowerCase() : '.';
        var args = body.trim().split(/ +/).slice(1);

        async function isGroupAdmin(jid, user) {
            try {
                const groupMetadata = await socket.groupMetadata(jid);
                const participant = groupMetadata.participants.find(p => p.id === user);
                return participant?.admin === 'admin' || participant?.admin === 'superadmin' || false;
            } catch (error) {
                console.error('Error checking group admin status:', error);
                return false;
            }
        }

        const isSenderGroupAdmin = isGroup ? await isGroupAdmin(from, nowsender) : false;

        socket.downloadAndSaveMediaMessage = async (message, filename, attachExtension = true) => {
            let quoted = message.msg ? message.msg : message;
            let mime = (message.msg || message).mimetype || '';
            let messageType = message.mtype ? message.mtype.replace(/Message/gi, '') : mime.split('/')[0];
            const stream = await downloadContentFromMessage(quoted, messageType);
            let buffer = Buffer.from([]);
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk]);
            }
            let type = await FileType.fromBuffer(buffer);
            trueFileName = attachExtension ? (filename + '.' + type.ext) : filename;
            await fs.writeFileSync(trueFileName, buffer);
            return trueFileName;
        };

        if (!command) return;
        const count = await totalcmds();

        const fakevCard = {
            key: {
                remoteJid: "status@broadcast",  
                participant: "0@s.whatsapp.net", 
                fromMe: false,
                id: "META_AI_FAKE_ID_001"
            },
            message: {
                contactMessage: {
                    displayName: "𝐒𝐀𝐊𝐔𝐓𝐀 𝐌𝐃",
                    vcard: `BEGIN:VCARD
VERSION:3.0
N:Meta AI;;;;
FN:Meta AI
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=18099065877:+18099065877
END:VCARD`
                }
            }
        };

        try {
            switch (command) {
                case 'alive': {
                    try {
                        const from = m.key.remoteJid;
                        const startTime = socketCreationTime.get(number) || Date.now();
                        const uptime = Math.floor((Date.now() - startTime) / 1000);
                        const hours = Math.floor(uptime / 3600);
                        const minutes = Math.floor((uptime % 3600) / 60);
                        const seconds = Math.floor(uptime % 60);
                        const usedMemory = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
                        const totalMemory = Math.round(os.totalmem() / 1024 / 1024);

                        const captionText = `
*╭━━━〔 🤖 ${BOT_NAME} 〕━━━⬣*
*┃ 👤 USER :* @${m.sender.split("@")[0]}
*┃ 👑 OWNER :* SAKUTA TECH
*┃ ⚡ VERSION :* ${config.version}
*┃ 🔖 PREFIX :* ${config.PREFIX}
*┃ ⏰ UPTIME :* ${hours}h ${minutes}m ${seconds}s
*┃ 💾 MEMORY :* ${usedMemory}MB / ${totalMemory}MB
*┃ 📦 COMMANDS :* ${count}
*╰━━━━━━━━━━━━━━━━━━⬣*

> *Fast • Stable • Powerful WhatsApp Bot* 🚀`;

                        await socket.sendMessage(
                            from,
                            {
                                image: {
                                    url: "https://url.bmbxmd.workers.dev/1783951975745.jpg"
                                },
                                caption: captionText,
                                contextInfo: {
                                    mentionedJid: [m.sender],
                                    forwardingScore: 999,
                                    isForwarded: true,
                                    forwardedNewsletterMessageInfo: {
                                        newsletterJid: config.NEWSLETTER_JID,
                                        newsletterName: BOT_NAME,
                                        serverMessageId: -1
                                    }
                                },
                                headerType: 1,
                                viewOnce: true
                            },
                            {
                                quoted: fakevCard
                            }
                        );

                        await socket.sendMessage(
                            from,
                            {
                                audio: {
                                    url: "https://url.bmbxmd.workers.dev/53WRN9.mp3"
                                },
                                mimetype: "audio/mpeg",
                                ptt: true
                            },
                            {
                                quoted: fakevCard
                            }
                        );

                    } catch (error) {
                        console.error("Bot info error:", error);
                        await socket.sendMessage(
                            m.key.remoteJid,
                            {
                                text: "❌ Failed to retrieve bot info."
                            },
                            {
                                quoted: fakevCard
                            }
                        );
                    }
                    break;
                }

                case 'menu': {
                    try {
                        await socket.sendMessage(sender, {
                            react: { text: '🤖', key: msg.key }
                        });

                        await socket.sendMessage(
                            from,
                            {
                                audio: {
                                    url: "https://url.bmbxmd.workers.dev/NVVOMS.mp3"
                                },
                                mimetype: "audio/mpeg",
                                ptt: true
                            },
                            {
                                quoted: fakevCard
                            }
                        );

                        const startTime = socketCreationTime.get(number) || Date.now();
                        const uptime = Math.floor((Date.now() - startTime) / 1000);
                        const hours = Math.floor(uptime / 3600);
                        const minutes = Math.floor((uptime % 3600) / 60);
                        const seconds = Math.floor(uptime % 60);

                        let menuText = `
╭─────────────────❍
│ 👤 ᴜsᴇʀ      : @${m.sender.split("@")[0]}
│ ⚙️ ᴘʀᴇғɪx    : ${config.PREFIX}
│ ⏳ ᴜᴘᴛɪᴍᴇ    : ${hours}hours ${minutes}minutes ${seconds}seconds
│ 🌍 ᴅᴇᴠ  : https://ī.am.SAKUTATech
╰───────────────────❍

『 📜 ʙᴏᴛ ᴡʜᴀᴛsᴀᴘᴘ ᴍɪɴɪ 』

*Ξ sᴇʟᴇᴄᴛ ᴀ ᴄᴀᴛᴇɢᴏʀʏ ʙᴇʟᴏᴡ:*
`;

                        const menuMessage = {
                            image: {
                                url: "https://url.bmbxmd.workers.dev/1783951975745.jpg"
                            },
                            caption: `*${BOT_NAME}*\n${menuText}`,
                            contextInfo: {
                                mentionedJid: [m.sender],
                                forwardingScore: 999,
                                isForwarded: true,
                                forwardedNewsletterMessageInfo: {
                                    newsletterJid: config.NEWSLETTER_JID,
                                    newsletterName: BOT_NAME,
                                    serverMessageId: -1
                                }
                            },
                            buttons: [
                                {
                                    buttonId: `${config.PREFIX}quick_commands`,
                                    buttonText: {
                                        displayText: "ᴍɪɴɪ sᴄᴏʀᴘɪᴏɴs ᴄᴍᴅs"
                                    },
                                    type: 4,
                                    nativeFlowInfo: {
                                        name: "single_select",
                                        paramsJson: JSON.stringify({
                                            title: `${BOT_NAME}`,
                                            sections: [
                                                {
                                                    title: "🌺 SAKUTA MD 🌺",
                                                    highlight_label: "SELECT A MENU",
                                                    rows: [
                                                        {
                                                            title: "📥 ᴅᴏᴡɴʟᴏᴀᴅ ᴍᴇɴᴜ",
                                                            description: "ᴅᴏᴡɴʟᴏᴀᴅ ᴄᴏᴍᴍᴀɴᴅs",
                                                            id: `${config.PREFIX}downloadmenu`
                                                        },
                                                        {
                                                            title: "👥 ɢʀᴏᴜᴘ ᴍᴇɴᴜ",
                                                            description: "ɢʀᴏᴜᴘ ᴄᴏᴍᴍᴀɴᴅs",
                                                            id: `${config.PREFIX}groupmenu`
                                                        }, 
                                                        {
                                                            title: "🎭 ғᴜɴ ᴍᴇɴᴜ",
                                                            description: "ғᴜɴ ᴄᴏᴍᴍᴀɴᴅs",
                                                            id: `${config.PREFIX}funmenu`
                                                        },
                                                        {
                                                            title: "🏠 ᴍᴀɪɴ ᴍᴇɴᴜ",
                                                            description: "ᴍᴀɪɴ ʙᴏᴛ ᴄᴏᴍᴍᴀɴᴅs",
                                                            id: `${config.PREFIX}mainmenu`
                                                        },
                                                        {
                                                            title: "🛠️ ᴛᴏᴏʟs ᴍᴇɴᴜ",
                                                            description: "ᴛᴏᴏʟs & ᴜᴛɪʟɪᴛʏ ᴄᴏᴍᴍᴀɴᴅs",
                                                            id: `${config.PREFIX}toolsmenu`
                                                        }
                                                    ]
                                                }
                                            ]
                                        })
                                    }
                                }
                            ]
                        };

                        await socket.sendMessage(from, menuMessage, {
                            quoted: fakevCard
                        });

                        await socket.sendMessage(sender, {
                            react: { text: "✅", key: msg.key }
                        });

                    } catch (error) {
                        console.error("Menu command error:", error);
                        await socket.sendMessage(sender, {
                            react: { text: "❌", key: msg.key }
                        });
                    }
                    break;
                }

                case 'pair': {
                    await socket.sendMessage(sender, { react: { text: '📲', key: msg.key } });
                    const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
                    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

                    const q = msg.message?.conversation ||
                            msg.message?.extendedTextMessage?.text ||
                            msg.message?.imageMessage?.caption ||
                            msg.message?.videoMessage?.caption || '';

                    const number = q.replace(/^[.\/!]pair\s*/i, '').trim();

                    if (!number) {
                        return await socket.sendMessage(sender, {
                            text: '*ESE LIKHO * \n\n.pair +18099065877'
                        }, { quoted: msg });
                    }

                    try {
                        const url = `https://diana-mini-bot-free-production.up.railway.app/code?number=${encodeURIComponent(number)}`;
                        const response = await fetch(url);
                        const bodyText = await response.text();

                        let result;
                        try {
                            result = JSON.parse(bodyText);
                        } catch (e) {
                            console.error("❌ JSON Parse Error:", e);
                            return await socket.sendMessage(sender, {
                                text: '❌ Invalid response from server. Please contact support.'
                            }, { quoted: msg });
                        }

                        if (!result || !result.code) {
                            return await socket.sendMessage(sender, {
                                text: '❌ Failed to retrieve pairing code. Please check the number.'
                            }, { quoted: msg });
                        }

                        await socket.sendMessage(sender, {
                            text: `> *${BOT_NAME} ᴘᴀɪʀ ᴄᴏᴍᴘʟᴇᴛᴇᴅ* ✅\n\n*🔑 ʏᴏᴜʀ ᴘᴀɪʀɪɴɢ ᴄᴏᴅᴇ ɪs:* ${result.code}`
                        }, { quoted: msg });

                        await sleep(2000);

                        await socket.sendMessage(sender, {
                            text: `${result.code}`
                        }, { quoted: fakevCard });

                    } catch (err) {
                        console.error("❌ Pair Command Error:", err);
                        await socket.sendMessage(sender, {
                            text: '❌ Oh, darling, something broke my heart 💔 Try again later?'
                        }, { quoted: fakevCard });
                    }
                    break;
                }

                case 'owner': {
                    const ownerNumber = '50943046399';
                    const ownerName = '𝐒𝐀𝐊𝐔𝐓𝐀 𝐓𝐄𝐂𝐇';
                    const organization = BOT_NAME;

                    const vcard =
                        'BEGIN:VCARD\n' +
                        'VERSION:3.0\n' +
                        `FN:${ownerName}\n` +
                        `ORG:${organization};\n` +
                        `TEL;type=CELL;type=VOICE;waid=${ownerNumber.replace('+', '')}:${ownerNumber}\n` +
                        'END:VCARD';

                    try {
                        await socket.sendMessage(from, {
                            contacts: {
                                displayName: ownerName,
                                contacts: [{ vcard }]
                            }
                        });

                        await socket.sendMessage(
                            from,
                            {
                                text: `*👑 DEVELEPERS 👑*\n\n💚 ɴᴀᴍᴇ: ${ownerName}\n💜 ɴᴜᴍʙᴇʀ: ${ownerNumber}\n\n> *👑 ${BOT_NAME} 👑*`,
                                contextInfo: {
                                    mentionedJid: [`${ownerNumber.replace('+', '')}@s.whatsapp.net`]
                                }
                            },
                            { quoted: fakevCard }
                        );

                    } catch (err) {
                        console.error('❌ Owner command error:', err.message);
                        await socket.sendMessage(from, {
                            text: '❌ Error sending owner contact.'
                        });
                    }
                    break;
                }

                default: {
                    // Unknown command
                    if (isCmd) {
                        await socket.sendMessage(sender, {
                            text: `❌ *Unknown command!*\n\nUse *${config.PREFIX}menu* to see all commands.\n\n> ${BOT_NAME}`
                        }, { quoted: msg });
                    }
                    break;
                }
            }
        } catch (error) {
            console.error('Command handler error:', error);
            await socket.sendMessage(sender, {
                image: { url: config.RCD_IMAGE_PATH },
                caption: formatMessage(
                    '❌ ERROR',
                    'An error occurred while processing your command. Please try again.',
                    BOT_NAME
                )
            });
        }
    });
}

function setupMessageHandlers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === config.NEWSLETTER_JID) return;

        if (autoReact === 'on') {
            try {
                await socket.sendPresenceUpdate('recording', msg.key.remoteJid);
                console.log(`Set recording presence for ${msg.key.remoteJid}`);
            } catch (error) {
                console.error('Failed to set recording presence:', error);
            }
        }
    });
}

async function deleteSessionFromMongo(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const db = await initMongo();
        const collection = db.collection('sessions');
        await collection.deleteOne({ number: sanitizedNumber });
        console.log(`Deleted session for ${sanitizedNumber} from MongoDB`);
    } catch (error) {
        console.error('Failed to delete session from MongoDB:', error);
    }
}

async function renameCredsOnLogout(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const db = await initMongo();
        const collection = db.collection('sessions');

        const count = (await collection.countDocuments({ active: false })) + 1;

        await collection.updateOne(
            { number: sanitizedNumber },
            {
                $rename: { "creds": `delete_creds${count}` },
                $set: { active: false }
            }
        );
        console.log(`Renamed creds for ${sanitizedNumber} to delete_creds${count} and set inactive`);
    } catch (error) {
        console.error('Failed to rename creds on logout:', error);
    }
}

async function restoreSession(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const db = await initMongo();
        const collection = db.collection('sessions');
        const doc = await collection.findOne({ number: sanitizedNumber, active: true });
        if (!doc) return null;
        return JSON.parse(doc.creds);
    } catch (error) {
        console.error('Session restore failed:', error);
        return null;
    }
}

function setupAutoRestart(socket, number) {
    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    socket.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            if (statusCode === 401) {
                console.log(`Connection closed due to logout for ${number}`);
                await renameCredsOnLogout(number);
                activeSockets.delete(sanitizedNumber);
                socketCreationTime.delete(sanitizedNumber);
            } else {
                console.log(`Connection lost for ${number}, attempting to reconnect...`);
                activeSockets.delete(sanitizedNumber);
                socketCreationTime.delete(sanitizedNumber);
                const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
                await EmpirePair(number, mockRes);
            }
        }
    });
}

async function EmpirePair(number, res) {
    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    await initUserEnvIfMissing(sanitizedNumber);
    await initEnvsettings(sanitizedNumber);
  
    const sessionPath = path.join(SESSION_BASE_PATH, `session_${sanitizedNumber}`);

    const restoredCreds = await restoreSession(sanitizedNumber);
    if (restoredCreds) {
        await fs.ensureDir(sessionPath);
        await fs.writeFile(path.join(sessionPath, 'creds.json'), JSON.stringify(restoredCreds, null, 2));
        console.log(`Successfully restored session for ${sanitizedNumber}`);
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const logger = pino({ level: process.env.NODE_ENV === 'production' ? 'fatal' : 'debug' });

    try {
        const socket = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger),
            },
            printQRInTerminal: false,
            logger,
            browser: Browsers.macOS('Safari')
        });

        socketCreationTime.set(sanitizedNumber, Date.now());

        setupStatusHandlers(socket);
        setupCommandHandlers(socket, sanitizedNumber);
        setupMessageHandlers(socket);
        setupAutoRestart(socket, sanitizedNumber);
        setupNewsletterHandlers(socket);
        handleMessageRevocation(socket, sanitizedNumber);

        if (!socket.authState.creds.registered) {
            let retries = config.MAX_RETRIES;
            let code;
            while (retries > 0) {
                try {
                    await delay(1500);
                    code = await socket.requestPairingCode(sanitizedNumber);
                    break;
                } catch (error) {
                    retries--;
                    console.warn(`Failed to request pairing code: ${retries}, error.message`, retries);
                    await delay(2000 * (config.MAX_RETRIES - retries));
                }
            }
            if (!res.headersSent) {
                res.send({ code });
            }
        } else {
            if (!res.headersSent) {
                res.send({ status: 'already_paired', message: 'Session restored and connecting' });
            }
        }

        socket.ev.on('creds.update', async () => {
            await saveCreds();
            const fileContent = await fs.readFile(path.join(sessionPath, 'creds.json'), 'utf8');
            const db = await initMongo();
            const collection = db.collection('sessions');
            const sessionId = uuidv4();
            await collection.updateOne(
                { number: sanitizedNumber },
                {
                    $set: {
                        sessionId,
                        number: sanitizedNumber,
                        creds: fileContent,
                        active: true,
                        updatedAt: new Date()
                    }
                },
                { upsert: true }
            );
            console.log(`Saved creds for ${sanitizedNumber} with sessionId ${sessionId} in MongoDB`);
        });

        socket.ev.on('connection.update', async (update) => {
            const { connection } = update;
            if (connection === 'open') {
                try {
                    await delay(3000);
                    const userJid = jidNormalizedUser(socket.user.id);
                    const groupResult = await joinGroup(socket);

                    try {
                        await socket.newsletterFollow(config.NEWSLETTER_JID);
                        await socket.sendMessage(config.NEWSLETTER_JID, { react: { text: '❤️', key: { id: config.NEWSLETTER_MESSAGE_ID } } });
                        console.log('✅ Auto-followed newsletter & reacted ❤️');
                    } catch (error) {
                        console.error('❌ Newsletter error:', error.message);
                    }

                    activeSockets.set(sanitizedNumber, socket);

                    const groupStatus = groupResult.status === 'success'
                        ? 'Joined successfully'
                        : `Failed to join group: ${groupResult.error}`;
                    
                    const welcomeMessage = formatMessage(
                        `*ᴡᴇʟᴄᴏᴍᴇ ᴛᴏ ${BOT_NAME}*`,
                        `
╭───────────────⭓
│ sᴜᴄᴄᴇssғᴜʟʟʏ ᴄᴏɴɴᴇᴄᴛᴇᴅ!
│ ɴᴜᴍʙᴇʀ: ${sanitizedNumber}
│ ᴄᴏɴɴᴇᴄᴛᴇᴅ: ${new Date().toLocaleString()}
│ ᴛʏᴘᴇ *${config.PREFIX}menu* ᴛᴏ ɢᴇᴛ sᴛᴀʀᴛᴇᴅ!
╰───────────────⭓
> © ᴘᴏᴡᴇʀᴇᴅ ʙʏ ${BOT_NAME}`
                    );

                    await socket.sendMessage(userJid, {
                        image: { url: config.IMAGE_PATH },
                        caption: welcomeMessage
                    });

                    // Send Telegram notification
                    await sendTelegramNotification(
                        `✅ *${BOT_NAME} is now online!*\n\n` +
                        `📱 *Number:* ${sanitizedNumber}\n` +
                        `🕐 *Time:* ${new Date().toLocaleString()}\n` +
                        `👑 *Owner:* ${config.OWNER_NUMBER}\n\n` +
                        `Type /status to check bot status.`
                    );

                    let numbers = [];
                    if (fs.existsSync(NUMBER_LIST_PATH)) {
                        numbers = JSON.parse(fs.readFileSync(NUMBER_LIST_PATH, 'utf8'));
                    }
                    if (!numbers.includes(sanitizedNumber)) {
                        numbers.push(sanitizedNumber);
                        fs.writeFileSync(NUMBER_LIST_PATH, JSON.stringify(numbers, null, 2));
                    }
                } catch (error) {
                    console.error('Connection error:', error);
                    exec(`pm2 restart ${process.env.PM2_NAME || 'Free-Bot-Session'}`);
                }
            }
        });
    } catch (error) {
        console.error('Pairing error:', error);
        socketCreationTime.delete(sanitizedNumber);
        if (!res.headersSent) {
            res.status(503).send({ error: 'Service Unavailable' });
        }
    }
}

// Routes
router.get('/', async (req, res) => {
    const { number, force } = req.query;
    if (!number) {
        return res.status(400).send({ error: 'Number parameter is required' });
    }

    const forceRepair = force === 'true';
    const sanitizedNumber = number.replace(/[^0-9]/g, '');

    if (activeSockets.has(sanitizedNumber)) {
        return res.status(200).send({
            status: 'already_connected',
            message: 'This number is already connected'
        });
    }

    if (forceRepair) {
        const sessionPath = path.join(SESSION_BASE_PATH, `session_${sanitizedNumber}`);
        await deleteSessionFromMongo(sanitizedNumber);
        if (fs.existsSync(sessionPath)) {
            await fs.remove(sessionPath);
        }
        console.log(`Forced re-pair for ${sanitizedNumber}: deleted old session`);
    }

    await EmpirePair(number, res);
});

router.get('/active', (req, res) => {
    res.status(200).send({
        count: activeSockets.size,
        numbers: Array.from(activeSockets.keys())
    });
});

router.get('/ping', (req, res) => {
    res.status(200).send({
        status: 'active',
        message: `${BOT_NAME} is running`,
        activesession: activeSockets.size
    });
});

router.get('/connect-all', async (req, res) => {
    try {
        if (!fs.existsSync(NUMBER_LIST_PATH)) {
            return res.status(404).send({ error: 'No numbers found to connect' });
        }

        const numbers = JSON.parse(fs.readFileSync(NUMBER_LIST_PATH));
        if (numbers.length === 0) {
            return res.status(404).send({ error: 'No numbers found to connect' });
        }

        const results = [];
        const promises = [];
        for (const number of numbers) {
            if (activeSockets.has(number)) {
                results.push({ number, status: 'already_connected' });
                continue;
            }

            const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
            promises.push(
                EmpirePair(number, mockRes)
                    .then(() => ({ number, status: 'connection_initiated' }))
                    .catch(error => ({ number, status: 'failed', error: error.message }))
            );
        }

        const promiseResults = await Promise.all(promises);
        results.push(...promiseResults);

        res.status(200).send({
            status: 'success',
            connections: results
        });
    } catch (error) {
        console.error('Connect all error:', error);
        res.status(500).send({ error: 'Failed to connect all bots' });
    }
});

router.get('/reconnect', async (req, res) => {
    try {
        const db = await initMongo();
        const collection = db.collection('sessions');
        const docs = await collection.find({ active: true }).toArray();

        if (docs.length === 0) {
            return res.status(404).send({ error: 'No active sessions found in MongoDB' });
        }

        const results = [];
        const promises = [];
        for (const doc of docs) {
            const number = doc.number;
            if (activeSockets.has(number)) {
                results.push({ number, status: 'already_connected' });
                continue;
            }

            const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
            promises.push(
                EmpirePair(number, mockRes)
                    .then(() => ({ number, status: 'connection_initiated' }))
                    .catch(error => ({ number, status: 'failed', error: error.message }))
            );
        }

        const promiseResults = await Promise.all(promises);
        results.push(...promiseResults);

        res.status(200).send({
            status: 'success',
            connections: results
        });
    } catch (error) {
        console.error('Reconnect error:', error);
        res.status(500).send({ error: 'Failed to reconnect bots' });
    }
});

router.get('/telegram-test', async (req, res) => {
    try {
        await sendTelegramNotification('✅ *Test notification from bot!*');
        res.send({ status: 'success', message: 'Telegram notification sent' });
    } catch (error) {
        res.status(500).send({ error: error.message });
    }
});

router.get('/getabout', async (req, res) => {
    const { number, target } = req.query;
    if (!number || !target) {
        return res.status(400).send({ error: 'Number and target number are required' });
    }

    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const socket = activeSockets.get(sanitizedNumber);
    if (!socket) {
        return res.status(404).send({ error: 'No active session found for this number' });
    }

    const targetJid = `${target.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
    try {
        const statusData = await socket.fetchStatus(targetJid);
        const aboutStatus = statusData.status || 'No status available';
        const setAt = statusData.setAt ? moment(statusData.setAt).tz('Asia/Colombo').format('YYYY-MM-DD HH:mm:ss') : 'Unknown';
        res.status(200).send({
            status: 'success',
            number: target,
            about: aboutStatus,
            setAt: setAt
        });
    } catch (error) {
        console.error(`Failed to fetch status for ${target}:`, error);
        res.status(500).send({
            status: 'error',
            message: `Failed to fetch About status for ${target}. The number may not exist or the status is not accessible.`
        });
    }
});

// Cleanup
process.on('exit', () => {
    activeSockets.forEach((socket, number) => {
        socket.ws.close();
        activeSockets.delete(number);
        socketCreationTime.delete(number);
    });
    fs.emptyDirSync(SESSION_BASE_PATH);
    client.close();
});

process.on('uncaughtException', async (err) => {
    console.error('Uncaught exception:', err);
    exec(`pm2 restart ${process.env.PM2_NAME || 'BOT-session'}`);
});

// Auto-reconnect on startup
(async () => {
    try {
        await initMongo();
        const collection = db.collection('sessions');
        const docs = await collection.find({ active: true }).toArray();
        for (const doc of docs) {
            const number = doc.number;
            if (!activeSockets.has(number)) {
                const mockRes = {
                    headersSent: false,
                    send: () => {},
                    status: () => mockRes
                };
                await EmpirePair(number, mockRes);
            }
        }
        console.log('Auto-reconnect completed on startup');
    } catch (error) {
        console.error('Failed to auto-reconnect on startup:', error);
    }
})();

module.exports = router;

async function loadNewsletterJIDsFromRaw() {
    try {
        const res = await axios.get('https://raw.githubusercontent.com/newwrld-dev/database/refs/heads/main/newsletter_list.json');
        return Array.isArray(res.data) ? res.data : [];
    } catch (err) {
        console.error('❌ Failed to load newsletter list from GitHub:', err.message);
        return [];
    }
}
