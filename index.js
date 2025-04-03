require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Bot, GrammyError, HttpError, Keyboard, InlineKeyboard, session } = require('grammy');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const { logger } = require('./utils/logger');
const { updateUserData, recordUserInteraction, isAdmin, getUsageStats, getMessages } = require('./utils/helpers');

const bot = new Bot(process.env.BOT_API_KEY);

bot.use(session({
  initial: () => ({})
}));

// Создание таблиц в базе данных
async function createTables(db) {
  await db.exec(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    timesStarted INTEGER DEFAULT 0,
    lastSeen TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  await db.exec(`CREATE TABLE IF NOT EXISTS interactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER,
    interactionTime TIMESTAMP
  )`);

  await db.exec(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER,
    message TEXT,
    media_type TEXT,
    media_id TEXT,
    replied INTEGER DEFAULT 0,
    first_name TEXT,
    username TEXT,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  logger.info('Tables created or already exist');
}

// Инициализация базы данных
let db;
(async () => {
  const dbPath = './userData.db';
  const dbExists = fs.existsSync(dbPath);

  db = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });

  if (!dbExists) {
    await createTables(db);
  }

  logger.info('Database initialized and connection established');
})();

// Команда /start
bot.command('start', async (ctx) => {
  logger.info(`User ${ctx.from.id} started the bot`);
  await updateUserData(db, ctx.from.id);
  const startKeyboard = new Keyboard()
    .text('📁 Отправить файл')
    .row();
  await ctx.reply('Привет! Я бот для сбора файлов к выпускному!');
  await ctx.reply('📁 Отправить файл — тут вы можете отправить файлы для выпускного альбома или презентации.');
  await ctx.reply('🟢 Поддерживаются фото, видео, аудио/видеосообщения, документы.');
  await ctx.reply('Нажмите кнопку ниже, чтобы отправить файл 👇', {
    reply_markup: startKeyboard,
  });
});

// Команда /admin (для администраторов)
bot.command('admin', async (ctx) => {
  if (isAdmin(ctx.from.id, [process.env.ADMIN_ID, process.env.ADMIN_ID2])) {
    const stats = await getUsageStats(db);
    const response = `Статистика использования бота для выпускного:\nВсего запусков: ${stats.totalStarts}\nИспользовали бота сегодня: ${stats.todayStarts}\nВсего взаимодействий: ${stats.totalInteractions}\nВзаимодействий сегодня: ${stats.todayInteractions}`;
    await ctx.reply(response);
  } else {
    await ctx.reply('У вас нет прав администратора!' + ctx.from.id.toString());
  }
});

// Логирование взаимодействий
bot.use(async (ctx, next) => {
  await recordUserInteraction(db, ctx.from.id);
  return next();
});

let suggestionClicked = {};
let unreadMessagesCount = 0;

// Обработка нажатия кнопки "📁 Отправить файл"
bot.hears('📁 Отправить файл', async (ctx) => {
  if (isAdmin(ctx.from.id, [process.env.ADMIN_ID, process.env.ADMIN_ID2])) {
    console.log('Admin accessed file submissions');
    const adminKeyboard = new Keyboard()
      .text('Все полученные файлы')
      .row()
      .text('Файлы без ответа')
      .row()
      .text('Назад ↩️')
      .row();
    await ctx.reply('Выберите действие:', {
      reply_markup: adminKeyboard,
    });
    suggestionClicked[ctx.from.id] = true;
  } else {
    suggestionClicked[ctx.from.id] = true;
    await ctx.reply('Отправьте файл, который вы хотите поделиться для выпускного альбома или презентации.');
  }
});

// Показать все полученные файлы (для админов)
bot.hears('Все полученные файлы', async (ctx) => {
  if (!isAdmin(ctx.from.id, [process.env.ADMIN_ID, process.env.ADMIN_ID2])) return;
  const messages = await getMessages(db);
  if (messages.length === 0) {
    await ctx.reply('Файлов нет.');
  } else {
    for (const message of messages) {
      const inlineKeyboard = new InlineKeyboard().text('Ответить', `reply-${message.id}`);
      const userInfo = `Файл от ${message.first_name} (@${message.username}, ID: ${message.userId})`;

      if (message.message) {
        await ctx.reply(`${userInfo}: ${message.message}`, { reply_markup: inlineKeyboard });
      } else {
        const mediaType = message.media_type;
        if (mediaType === 'photo') {
          await ctx.api.sendPhoto(ctx.chat.id, message.media_id, {
            caption: userInfo,
            reply_markup: inlineKeyboard
          });
        } else if (mediaType === 'video') {
          await ctx.api.sendVideo(ctx.chat.id, message.media_id, {
            caption: userInfo,
            reply_markup: inlineKeyboard
          });
        } else if (mediaType === 'document') {
          await ctx.api.sendDocument(ctx.chat.id, message.media_id, {
            caption: userInfo,
            reply_markup: inlineKeyboard
          });
        } else if (mediaType === 'audio') {
          await ctx.api.sendAudio(ctx.chat.id, message.media_id, {
            caption: userInfo,
            reply_markup: inlineKeyboard
          });
        } else if (mediaType === 'voice') {
          await ctx.api.sendVoice(ctx.chat.id, message.media_id, {
            caption: userInfo,
            reply_markup: inlineKeyboard
          });
        } else if (mediaType === 'video_note') {
          await ctx.api.sendVideoNote(ctx.chat.id, message.media_id, {
            caption: userInfo,
            reply_markup: inlineKeyboard
          });
        }
      }
    }
  }
});

// Показать файлы без ответа (для админов)
bot.hears('Файлы без ответа', async (ctx) => {
  if (!isAdmin(ctx.from.id, [process.env.ADMIN_ID, process.env.ADMIN_ID2])) return;

  const messages = await getMessages(db, 0);
  if (messages.length === 0) {
    await ctx.reply('Файлов без ответа нет.');
  } else {
    for (const message of messages) {
      const inlineKeyboard = new InlineKeyboard().text('Ответить', `reply-${message.id}`);
      const userInfo = `Файл от ${message.first_name} (@${message.username}, ID: ${message.userId})`;

      if (message.message) {
        await ctx.reply(`${userInfo}: ${message.message}`, { reply_markup: inlineKeyboard });
      } else {
        const mediaType = message.media_type;
        if (mediaType === 'photo') {
          await ctx.api.sendPhoto(ctx.chat.id, message.media_id, {
            caption: userInfo,
            reply_markup: inlineKeyboard
          });
        } else if (mediaType === 'video') {
          await ctx.api.sendVideo(ctx.chat.id, message.media_id, {
            caption: userInfo,
            reply_markup: inlineKeyboard
          });
        } else if (mediaType === 'document') {
          await ctx.api.sendDocument(ctx.chat.id, message.media_id, {
            caption: userInfo,
            reply_markup: inlineKeyboard
          });
        } else if (mediaType === 'audio') {
          await ctx.api.sendAudio(ctx.chat.id, message.media_id, {
            caption: userInfo,
            reply_markup: inlineKeyboard
          });
        } else if (mediaType === 'voice') {
          await ctx.api.sendVoice(ctx.chat.id, message.media_id, {
            caption: userInfo,
            reply_markup: inlineKeyboard
          });
        } else if (mediaType === 'video_note') {
          await ctx.api.sendVideoNote(ctx.chat.id, message.media_id, {
            caption: userInfo,
            reply_markup: inlineKeyboard
          });
        }
      }
    }
  }
});

// Кнопка "Назад"
bot.hears('Назад ↩️', async (ctx) => {
  const startKeyboard = new Keyboard()
    .text('📁 Отправить файл')
    .row();
  await ctx.reply('Выберите действие:', {
    reply_markup: startKeyboard,
  });
});

// Обработка сообщений от пользователей
bot.on('message', async (ctx) => {
  const adminIds = [process.env.ADMIN_ID, process.env.ADMIN_ID2];
  const fromId = ctx.from.id.toString();

  // Ответ администратора
  if (adminIds.includes(fromId) && ctx.session.replyToUser) {
    const targetMessageId = ctx.session.replyToMessageId;

    await db.run(`UPDATE messages SET replied = 1 WHERE id = ?`, [targetMessageId]);
    await ctx.api.sendMessage(ctx.session.replyToUser, 'На ваше сообщение получен ответ от организатора выпускного.');

    if (ctx.message.text) {
      await ctx.api.sendMessage(ctx.session.replyToUser, ctx.message.text);
    } else if (ctx.message.voice) {
      await ctx.api.sendVoice(ctx.session.replyToUser, ctx.message.voice.file_id);
    } else if (ctx.message.video) {
      await ctx.api.sendVideo(ctx.session.replyToUser, ctx.message.video.file_id);
    } else if (ctx.message.photo) {
      const photo = ctx.message.photo.pop();
      await ctx.api.sendPhoto(ctx.session.replyToUser, photo.file_id);
    } else if (ctx.message.audio) {
      await ctx.api.sendAudio(ctx.session.replyToUser, ctx.message.audio.file_id);
    } else if (ctx.message.document) {
      await ctx.api.sendDocument(ctx.session.replyToUser, ctx.message.document.file_id);
    } else if (ctx.message.video_note) {
      await ctx.api.sendVideoNote(ctx.session.replyToUser, ctx.message.video_note.file_id);
    }

    await ctx.reply('Ответ направлен.');
    ctx.session.replyToUser = undefined;
    ctx.session.replyToMessageId = undefined;

    if (unreadMessagesCount > 0) {
      unreadMessagesCount--;
    }
    return;
  }

  // Обработка отправки файла пользователем
  if (suggestionClicked[fromId]) {
    console.log('User sent a file.');
    let mediaType = '';
    let mediaId = '';

    if (ctx.message.text) {
      await db.run(`INSERT INTO messages (userId, message, first_name, username) VALUES (?, ?, ?, ?)`, 
                   [ctx.from.id, ctx.message.text, ctx.from.first_name, ctx.from.username]);
    } else {
      if (ctx.message.photo) {
        const photo = ctx.message.photo.pop();
        mediaType = 'photo';
        mediaId = photo.file_id;
      } else if (ctx.message.video) {
        mediaType = 'video';
        mediaId = ctx.message.video.file_id;
      } else if (ctx.message.document) {
        mediaType = 'document';
        mediaId = ctx.message.document.file_id;
      } else if (ctx.message.audio) {
        mediaType = 'audio';
        mediaId = ctx.message.audio.file_id;
      } else if (ctx.message.voice) {
        mediaType = 'voice';
        mediaId = ctx.message.voice.file_id;
      } else if (ctx.message.video_note) {
        mediaType = 'video_note';
        mediaId = ctx.message.video_note.file_id;
      }

      await db.run(`INSERT INTO messages (userId, media_type, media_id, first_name, username) VALUES (?, ?, ?, ?, ?)`,
                   [ctx.from.id, mediaType, mediaId, ctx.from.first_name, ctx.from.username]);
    }

    await ctx.reply('Ваш файл успешно отправлен организаторам выпускного.');
    suggestionClicked[fromId] = false;

    unreadMessagesCount++;
    console.log(`Admin notified, new unreadMessagesCount: ${unreadMessagesCount}`);
    for (const adminId of adminIds) {
      await ctx.api.sendMessage(adminId, `Получен новый файл для выпускного. Неотвеченных сообщений: ${unreadMessagesCount}`);
    }
  } else {
    if (!adminIds.includes(fromId)) {
      console.log('User is not admin and did not click file submission.');
      await ctx.reply('Пожалуйста, сначала нажмите кнопку "📁 Отправить файл" для отправки файла организаторам выпускного!');
    } else {
      console.log('Admin received a new file.');
      unreadMessagesCount++;
      console.log(`Admin notified, new unreadMessagesCount: ${unreadMessagesCount}`);
      for (const adminId of adminIds) {
        await ctx.api.sendMessage(adminId, `Получен новый файл для выпускного. Неотвеченных сообщений: ${unreadMessagesCount}`);
      }
    }
  }
});

// Обработка ответа администратора через inline-кнопку
bot.callbackQuery(/^reply-(\d+)$/, async (ctx) => {
  const targetMessageId = ctx.match[1];
  const targetMessage = await db.get('SELECT userId FROM messages WHERE id = ?', [targetMessageId]);

  if (targetMessage) {
    ctx.session.replyToUser = targetMessage.userId;
    ctx.session.replyToMessageId = targetMessageId;
    await ctx.answerCallbackQuery('Вы можете ответить текстом, аудио, видео или фото.');
  } else {
    await ctx.answerCallbackQuery('Сообщение не найдено.', { show_alert: true });
  }
});

// Обработка ошибок
bot.catch((err) => {
  const ctx = err.ctx;
  logger.error(`Error while handling update ${ctx.update.update_id}:`, err);
});

// Запуск бота
bot.start();
