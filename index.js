const express = require('express');
const app = express();
const path = require('path');
const bodyParser = require("body-parser");
const { Telegraf } = require('telegraf');
const fs = require('fs-extra');

require('events').EventEmitter.defaultMaxListeners = 500;

const PORT = process.env.PORT || 8000;
const BOT_NAME = process.env.BOT_NAME || '𝐒𝐀𝐊𝐔𝐓𝐀 𝐌𝐃';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_OWNER_ID = process.env.TELEGRAM_OWNER_ID;
const NEWSLETTER_JID = process.env.NEWSLETTER_JID || '120363422843574549@newsletter';
const OWNER_NUMBER = process.env.OWNER_NUMBER || '50943046399';

__path = process.cwd();
let code = require('./pair');

// Initialize Telegram Bot
let telegramBot = null;
if (TELEGRAM_BOT_TOKEN) {
  telegramBot = new Telegraf(TELEGRAM_BOT_TOKEN);
  setupTelegramBot();
} else {
  console.log('⚠️ TELEGRAM_BOT_TOKEN not set. Telegram features disabled.');
}

function setupTelegramBot() {
  // Start command
  telegramBot.start(async (ctx) => {
    const user = ctx.from;
    const isOwner = user.id.toString() === TELEGRAM_OWNER_ID;
    
    await ctx.replyWithPhoto(
      'https://url.bmbxmd.workers.dev/1783951975745.jpg',
      {
        caption: `*🤖 ${BOT_NAME}*\n\n` +
                 `👤 *User:* ${user.first_name}\n` +
                 `🆔 *ID:* ${user.id}\n` +
                 `🔑 *Role:* ${isOwner ? '👑 Owner' : '👤 User'}\n\n` +
                 `📋 *Available Commands:*\n` +
                 `/start - Show this menu\n` +
                 `/pair <number> - Get pairing code\n` +
                 `/connect <number> - Connect WhatsApp\n` +
                 `/status - Check bot status\n` +
                 `/stats - Show bot statistics\n` +
                 `/restart - Restart bot (Owner only)\n\n` +
                 `> *${BOT_NAME}*`,
        parse_mode: 'Markdown'
      }
    );
  });

  // Pair command - Get pairing code
  telegramBot.command('pair', async (ctx) => {
    const user = ctx.from;
    const isOwner = user.id.toString() === TELEGRAM_OWNER_ID;
    
    if (!isOwner) {
      return ctx.reply('❌ *Access Denied!* Only the bot owner can use this command.', { parse_mode: 'Markdown' });
    }

    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
      return ctx.reply('❌ *Usage:* `/pair <phone_number>`\nExample: `/pair 18099065877`', { parse_mode: 'Markdown' });
    }

    const number = args[1].replace(/[^0-9]/g, '');
    if (number.length < 10) {
      return ctx.reply('❌ *Invalid phone number!* Please enter a valid number with country code.', { parse_mode: 'Markdown' });
    }

    await ctx.reply(`⏳ *Generating pairing code for ${number}...*`, { parse_mode: 'Markdown' });

    try {
      const axios = require('axios');
      const response = await axios.get(`http://localhost:${PORT}/code?number=${number}`);
      const code = response.data.code;
      
      await ctx.reply(
        `✅ *Pairing Code Generated!*\n\n` +
        `📱 *Number:* ${number}\n` +
        `🔑 *Code:* \`${code}\`\n\n` +
        `1. Open WhatsApp on your phone\n` +
        `2. Go to Settings > Linked Devices\n` +
        `3. Tap "Link a Device"\n` +
        `4. Enter the code above\n\n` +
        `> *${BOT_NAME}*`,
        { parse_mode: 'Markdown' }
      );
    } catch (error) {
      console.error('Pair command error:', error);
      ctx.reply(`❌ *Failed to generate pairing code!*\nError: ${error.message}`, { parse_mode: 'Markdown' });
    }
  });

  // Connect command - Connect WhatsApp
  telegramBot.command('connect', async (ctx) => {
    const user = ctx.from;
    const isOwner = user.id.toString() === TELEGRAM_OWNER_ID;
    
    if (!isOwner) {
      return ctx.reply('❌ *Access Denied!* Only the bot owner can use this command.', { parse_mode: 'Markdown' });
    }

    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
      return ctx.reply('❌ *Usage:* `/connect <phone_number>`\nExample: `/connect 18099065877`', { parse_mode: 'Markdown' });
    }

    const number = args[1].replace(/[^0-9]/g, '');
    if (number.length < 10) {
      return ctx.reply('❌ *Invalid phone number!*', { parse_mode: 'Markdown' });
    }

    await ctx.reply(`⏳ *Connecting to ${number}...*`, { parse_mode: 'Markdown' });

    try {
      const axios = require('axios');
      const response = await axios.get(`http://localhost:${PORT}/code?number=${number}&force=true`);
      
      if (response.data.status === 'already_connected') {
        return ctx.reply(`✅ *Already connected to ${number}!*`, { parse_mode: 'Markdown' });
      }

      ctx.reply(
        `✅ *Connection initiated for ${number}!*\n\n` +
        `📱 *Number:* ${number}\n` +
        `🔑 *Pairing Code:* \`${response.data.code}\`\n\n` +
        `Enter this code in WhatsApp to link the device.\n\n` +
        `> *${BOT_NAME}*`,
        { parse_mode: 'Markdown' }
      );
    } catch (error) {
      console.error('Connect command error:', error);
      ctx.reply(`❌ *Failed to connect!*\nError: ${error.message}`, { parse_mode: 'Markdown' });
    }
  });

  // Status command
  telegramBot.command('status', async (ctx) => {
    const user = ctx.from;
    const isOwner = user.id.toString() === TELEGRAM_OWNER_ID;
    
    try {
      const axios = require('axios');
      const response = await axios.get(`http://localhost:${PORT}/code/ping`);
      
      await ctx.replyWithPhoto(
        'https://url.bmbxmd.workers.dev/1783951975745.jpg',
        {
          caption: `*🤖 ${BOT_NAME} Status*\n\n` +
                   `📊 *Status:* ${response.data.status}\n` +
                   `📱 *Active Sessions:* ${response.data.activesession || 0}\n` +
                   `🕐 *Uptime:* ${process.uptime().toFixed(0)}s\n` +
                   `👤 *User:* ${user.first_name}\n` +
                   `🔑 *Role:* ${isOwner ? '👑 Owner' : '👤 User'}\n\n` +
                   `> *${BOT_NAME}*`,
          parse_mode: 'Markdown'
        }
      );
    } catch (error) {
      ctx.reply(`❌ *Bot is offline or not responding!*`, { parse_mode: 'Markdown' });
    }
  });

  // Stats command
  telegramBot.command('stats', async (ctx) => {
    const user = ctx.from;
    const isOwner = user.id.toString() === TELEGRAM_OWNER_ID;
    
    if (!isOwner) {
      return ctx.reply('❌ *Access Denied!* Only the bot owner can view stats.', { parse_mode: 'Markdown' });
    }

    try {
      const axios = require('axios');
      const response = await axios.get(`http://localhost:${PORT}/code/active`);
      
      const memoryUsage = process.memoryUsage();
      const uptime = process.uptime();
      const hours = Math.floor(uptime / 3600);
      const minutes = Math.floor((uptime % 3600) / 60);
      const seconds = Math.floor(uptime % 60);

      let statsText = `*📊 ${BOT_NAME} Statistics*\n\n`;
      statsText += `👥 *Active Sessions:* ${response.data.count || 0}\n`;
      statsText += `📱 *Connected Numbers:*\n`;
      
      if (response.data.numbers && response.data.numbers.length > 0) {
        response.data.numbers.forEach((num, i) => {
          statsText += `   ${i+1}. ${num}\n`;
        });
      } else {
        statsText += `   No numbers connected\n`;
      }
      
      statsText += `\n⏱️ *Uptime:* ${hours}h ${minutes}m ${seconds}s\n`;
      statsText += `💾 *Memory:* ${(memoryUsage.heapUsed / 1024 / 1024).toFixed(2)} MB\n`;
      statsText += `👤 *Owner:* ${user.first_name}\n\n`;
      statsText += `> *${BOT_NAME}*`;

      await ctx.reply(statsText, { parse_mode: 'Markdown' });
    } catch (error) {
      ctx.reply(`❌ *Failed to get stats!*\nError: ${error.message}`, { parse_mode: 'Markdown' });
    }
  });

  // Restart command (Owner only)
  telegramBot.command('restart', async (ctx) => {
    const user = ctx.from;
    const isOwner = user.id.toString() === TELEGRAM_OWNER_ID;
    
    if (!isOwner) {
      return ctx.reply('❌ *Access Denied!* Only the bot owner can restart.', { parse_mode: 'Markdown' });
    }

    await ctx.reply(`🔄 *Restarting ${BOT_NAME}...*`, { parse_mode: 'Markdown' });
    
    setTimeout(() => {
      process.exit(0);
    }, 1000);
  });

  // Handle any message (for testing)
  telegramBot.on('text', async (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith('/')) return;
    
    if (ctx.from.id.toString() === TELEGRAM_OWNER_ID) {
      await ctx.reply(`🤖 *${BOT_NAME} is online!*\nUse /pair or /connect commands.`, { parse_mode: 'Markdown' });
    }
  });

  // Start Telegram bot
  telegramBot.launch().then(() => {
    console.log('✅ Telegram bot started successfully!');
    console.log(`📢 Bot name: ${BOT_NAME}`);
    console.log(`👑 Owner ID: ${TELEGRAM_OWNER_ID}`);
  }).catch(err => {
    console.error('❌ Failed to start Telegram bot:', err);
  });

  process.once('SIGINT', () => telegramBot.stop('SIGINT'));
  process.once('SIGTERM', () => telegramBot.stop('SIGTERM'));
}

// Express Routes
app.use('/code', code);
app.use('/pair', async (req, res, next) => {
    res.sendFile(__path + '/pair.html');
});
app.use('/', async (req, res, next) => {
    res.sendFile(__path + '/main.html');
});

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.listen(PORT, () => {
    console.log(`
╔═════════════════════════════════════════╗
║     🤖 ${BOT_NAME} 🤖              ║
║     🚀 Server running on port ${PORT}     ║
║     📱 Pairing endpoint: /code          ║
║     🔗 Web: http://localhost:${PORT}     ║
║     🤖 Telegram: ${TELEGRAM_BOT_TOKEN ? '✅ Active' : '❌ Disabled'}  ║
╚═════════════════════════════════════════╝
    `);
});

module.exports = app;
