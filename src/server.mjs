import dotenv from 'dotenv';
import { Telegraf } from 'telegraf';
import { pool, requireUser, initDb, logTx } from './db.mjs';

dotenv.config();

const BOT_NAME = 'BlackFox Game';
const CURRENCY = 'Фоксы';
const GEM = 'Кристаллы';
const bot = new Telegraf(process.env.BOT_TOKEN);
const adminIds = new Set((process.env.ADMIN_IDS || '').split(',').map(x => Number(x.trim())).filter(Boolean));

const businesses = [
  { id: 1, title: 'Кофейня у лиса', price: 75000, income: 9000 },
  { id: 2, title: 'Неоновый бар', price: 250000, income: 35000 },
  { id: 3, title: 'Кибер-арена', price: 900000, income: 135000 },
  { id: 4, title: 'Fox Casino Hall', price: 2500000, income: 420000 },
  { id: 5, title: 'Черный небоскреб', price: 9000000, income: 1600000 }
];

const houses = [
  { id: 1, title: 'Комната в общаге', price: 45000 },
  { id: 2, title: 'Квартира в центре', price: 350000 },
  { id: 3, title: 'Пентхаус', price: 2500000 },
  { id: 4, title: 'Вилла BlackFox', price: 12000000 }
];

const cars = [
  { id: 1, title: 'Старая BMW', price: 120000 },
  { id: 2, title: 'Neon GT', price: 850000 },
  { id: 3, title: 'Fox Phantom', price: 4200000 },
  { id: 4, title: 'Hyper Beast', price: 15000000 }
];

function money(v) { return `${Number(v || 0).toLocaleString('ru-RU')} ${CURRENCY}`; }
function gems(v) { return `${Number(v || 0).toLocaleString('ru-RU')} ${GEM}`; }
function isAdmin(ctx) { return adminIds.has(ctx.from.id); }
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function parseAmount(raw, user) {
  const s = String(raw || '').trim().toLowerCase();
  const balance = Number(user.foxes);
  if (['все', 'all', 'вабанк'].includes(s)) return Math.floor(balance);
  if (['половина', 'half', 'пол'].includes(s)) return Math.floor(balance / 2);
  const n = Number(s.replace(/\s/g, ''));
  return Number.isFinite(n) ? Math.floor(n) : NaN;
}
async function addXp(userId, amount) {
  const r = await pool.query('UPDATE users SET xp = xp + $1 WHERE id = $2 RETURNING xp, level', [amount, userId]);
  const u = r.rows[0];
  const nextLevel = Math.max(1, Math.floor(Number(u.xp) / 1000) + 1);
  if (nextLevel > Number(u.level)) {
    await pool.query('UPDATE users SET level = $1, foxes = foxes + $2 WHERE id = $3', [nextLevel, nextLevel * 2500, userId]);
    return nextLevel;
  }
  return null;
}
async function findUserByMention(mention) {
  const username = mention.replace('@', '').toLowerCase();
  const r = await pool.query('SELECT * FROM users WHERE LOWER(username) = $1', [username]);
  return r.rows[0];
}

const helpText = `🦊 ${BOT_NAME}

Валюта: ${CURRENCY}
Донат-валюта: ${GEM}

🎮 Игрок:
профиль / баланс
бонус
работа
реф
передать @user сумма

🎰 Развлекуха:
казино сумма
казино все
казино половина
казино инфо
монетка сумма орел/решка
кубик сумма
кейс
кейс купить

🏦 Экономика:
банк
банк положить сумма
банк снять сумма
магазин
купить бизнес 1
купить дом 1
купить машина 1
бизнес
собрать

🛡 Кланы:
клан
клан создать Название
клан вступить ID
клан донат сумма
топ кланы

🏆 Рейтинги:
топ
промо КОД

Важно: это виртуальная игра без вывода денег.`;

bot.start(async (ctx) => {
  const user = await requireUser(ctx);
  await ctx.reply(`🦊 Добро пожаловать в ${BOT_NAME}!

Тебе начислено: ${money(user.foxes)}
Пиши: помощь`);
});

bot.hears(/^(помощь|help|меню)$/i, async (ctx) => { await requireUser(ctx); await ctx.reply(helpText); });

bot.hears(/^(баланс|профиль|profile)$/i, async (ctx) => {
  const user = await requireUser(ctx);
  const inv = await pool.query('SELECT item_type, COUNT(*) c FROM inventory WHERE user_id=$1 GROUP BY item_type', [user.id]);
  const items = Object.fromEntries(inv.rows.map(x => [x.item_type, x.c]));
  await ctx.reply(`👤 ${ctx.from.first_name}

💰 Баланс: ${money(user.foxes)}
🏦 Банк: ${money(user.bank)}
💎 ${gems(user.crystals)}
⭐ VIP: ${user.vip_level}
📈 Уровень: ${user.level} | XP: ${user.xp}
⚡ Энергия: ${user.energy}/10

🏢 Бизнесов: ${items.business || 0}
🏠 Домов: ${items.house || 0}
🚗 Машин: ${items.car || 0}`);
});

bot.hears(/^бонус$/i, async (ctx) => {
  const user = await requireUser(ctx);
  const now = Date.now();
  const last = user.last_bonus_at ? new Date(user.last_bonus_at).getTime() : 0;
  if (last && now - last < 24 * 60 * 60 * 1000) return ctx.reply('⏳ Бонус уже забран. Следующий доступен через 24 часа после прошлого.');
  const reward = 25000 + Number(user.level) * 1500 + Number(user.vip_level) * 10000;
  const crystals = Math.random() < 0.2 ? 1 : 0;
  await pool.query('UPDATE users SET foxes = foxes + $1, crystals = crystals + $2, last_bonus_at = NOW() WHERE id=$3', [reward, crystals, user.id]);
  await logTx(user.id, 'daily_bonus', reward, 'daily');
  const lvl = await addXp(user.id, 80);
  await ctx.reply(`🎁 Ежедневный бонус!

+${money(reward)}${crystals ? `
+${gems(crystals)}` : ''}${lvl ? `

🔥 Новый уровень: ${lvl}` : ''}`);
});

bot.hears(/^работа$/i, async (ctx) => {
  const user = await requireUser(ctx);
  const now = Date.now();
  const last = user.last_work_at ? new Date(user.last_work_at).getTime() : 0;
  if (last && now - last < 10 * 60 * 1000) return ctx.reply('⏳ Работать можно раз в 10 минут. Лис устал, дайте ему водички.');
  const reward = randInt(5000, 18000) + Number(user.level) * 1200;
  await pool.query('UPDATE users SET foxes=foxes+$1, last_work_at=NOW() WHERE id=$2', [reward, user.id]);
  await logTx(user.id, 'work', reward);
  const lvl = await addXp(user.id, 120);
  await ctx.reply(`🧰 Ты подработал в BlackFox-сети.

+${money(reward)}${lvl ? `
🔥 Новый уровень: ${lvl}` : ''}`);
});

bot.hears(/^банк$/i, async (ctx) => {
  const user = await requireUser(ctx);
  await ctx.reply(`🏦 BlackFox Bank

На руках: ${money(user.foxes)}
В банке: ${money(user.bank)}

Команды:
банк положить 1000
банк снять 1000
банк положить все`);
});

bot.hears(/^банк\s+(положить|деп|deposit)\s+(.+)$/i, async (ctx) => {
  const user = await requireUser(ctx);
  const amount = parseAmount(ctx.match[2], user);
  if (!amount || amount < 1) return ctx.reply('❌ Укажи сумму: банк положить 1000');
  if (Number(user.foxes) < amount) return ctx.reply('❌ Не хватает Фоксов на руках.');
  await pool.query('UPDATE users SET foxes=foxes-$1, bank=bank+$1 WHERE id=$2', [amount, user.id]);
  await ctx.reply(`🏦 В банк положено: ${money(amount)}`);
});

bot.hears(/^банк\s+(снять|вывести|withdraw)\s+(.+)$/i, async (ctx) => {
  const user = await requireUser(ctx);
  const bankUser = { ...user, foxes: user.bank };
  const amount = parseAmount(ctx.match[2], bankUser);
  if (!amount || amount < 1) return ctx.reply('❌ Укажи сумму: банк снять 1000');
  if (Number(user.bank) < amount) return ctx.reply('❌ В банке нет столько Фоксов.');
  await pool.query('UPDATE users SET foxes=foxes+$1, bank=bank-$1 WHERE id=$2', [amount, user.id]);
  await ctx.reply(`🏦 Снято из банка: ${money(amount)}`);
});

bot.hears(/^казино(?:\s+(.+))?$/i, async (ctx) => {
  const user = await requireUser(ctx);
  const raw = ctx.match[1];
  if (!raw || raw.toLowerCase() === 'инфо') {
    return ctx.reply(`🎰 BlackFox Casino

Команды:
казино 1000
казино все
казино половина

Шансы:
💎 x5 — 3%
🔥 x3 — 8%
🎰 x2 — 31%
💸 проигрыш — 58%

Ставки только виртуальными Фоксами.`);
  }
  const bet = parseAmount(raw, user);
  if (!bet || bet < 100) return ctx.reply('❌ Минимальная ставка: 100 Фоксов.');
  if (bet > Number(user.foxes)) return ctx.reply('❌ Недостаточно Фоксов.');
  const r = Math.random();
  let multiplier = 0;
  if (r < 0.03) multiplier = 5;
  else if (r < 0.11) multiplier = 3;
  else if (r < 0.42) multiplier = 2;
  const delta = multiplier ? bet * (multiplier - 1) : -bet;
  await pool.query('UPDATE users SET foxes = foxes + $1 WHERE id=$2', [delta, user.id]);
  await logTx(user.id, 'casino', delta, `bet=${bet};x=${multiplier}`);
  await addXp(user.id, Math.min(250, Math.floor(bet / 1000) + 25));
  if (!multiplier) return ctx.reply(`💸 Казино съело ставку.

Ставка: ${money(bet)}
Проигрыш: ${money(bet)}`);
  await ctx.reply(`🎰 JACKFOX!

Ставка: ${money(bet)}
Множитель: x${multiplier}
Выигрыш: ${money(bet * multiplier)}
Чистая прибыль: ${money(delta)}`);
});

bot.hears(/^монетка\s+(.+)\s+(орел|орёл|решка)$/i, async (ctx) => {
  const user = await requireUser(ctx);
  const bet = parseAmount(ctx.match[1], user);
  const choice = ctx.match[2].toLowerCase().replace('ё', 'е');
  if (!bet || bet < 100) return ctx.reply('❌ Минимальная ставка: 100 Фоксов.');
  if (bet > Number(user.foxes)) return ctx.reply('❌ Недостаточно Фоксов.');
  const result = Math.random() < 0.5 ? 'орел' : 'решка';
  const win = result === choice;
  const delta = win ? bet : -bet;
  await pool.query('UPDATE users SET foxes=foxes+$1 WHERE id=$2', [delta, user.id]);
  await logTx(user.id, 'coin', delta, result);
  await ctx.reply(`🪙 Выпало: ${result}

${win ? `✅ Победа: +${money(bet)}` : `❌ Проигрыш: -${money(bet)}`}`);
});

bot.hears(/^кубик\s+(.+)$/i, async (ctx) => {
  const user = await requireUser(ctx);
  const bet = parseAmount(ctx.match[1], user);
  if (!bet || bet < 100) return ctx.reply('❌ Минимальная ставка: 100 Фоксов.');
  if (bet > Number(user.foxes)) return ctx.reply('❌ Недостаточно Фоксов.');
  const roll = randInt(1, 6);
  const multiplier = roll === 6 ? 4 : roll >= 4 ? 2 : 0;
  const delta = multiplier ? bet * (multiplier - 1) : -bet;
  await pool.query('UPDATE users SET foxes=foxes+$1 WHERE id=$2', [delta, user.id]);
  await logTx(user.id, 'dice', delta, `roll=${roll}`);
  await ctx.reply(`🎲 Выпало: ${roll}

${multiplier ? `✅ Множитель x${multiplier}, прибыль: ${money(delta)}` : `❌ Проигрыш: ${money(bet)}`}`);
});

bot.hears(/^кейс$/i, async (ctx) => {
  await requireUser(ctx);
  await ctx.reply(`📦 BlackFox Case

Команда: кейс купить
Цена: 10 ${GEM}

Может выпасть:
• 25 000–150 000 Фоксов
• 1–10 Кристаллов
• редкий jackpot`);
});

bot.hears(/^кейс\s+купить$/i, async (ctx) => {
  const user = await requireUser(ctx);
  if (Number(user.crystals) < 10) return ctx.reply(`❌ Нужно 10 ${GEM}.`);
  const r = Math.random();
  let foxReward = randInt(25000, 150000);
  let crystalReward = 0;
  let label = 'обычный дроп';
  if (r < 0.07) { foxReward = randInt(500000, 1500000); crystalReward = randInt(5, 15); label = '💎 редкий jackpot'; }
  else if (r < 0.25) { crystalReward = randInt(1, 10); label = '✨ кристальный дроп'; }
  await pool.query('UPDATE users SET crystals=crystals-10+$1, foxes=foxes+$2 WHERE id=$3', [crystalReward, foxReward, user.id]);
  await logTx(user.id, 'case', foxReward, label);
  await ctx.reply(`📦 Кейс открыт: ${label}

+${money(foxReward)}${crystalReward ? `
+${gems(crystalReward)}` : ''}`);
});

bot.hears(/^магазин$/i, async (ctx) => {
  await requireUser(ctx);
  const b = businesses.map(x => `${x.id}. ${x.title} — ${money(x.price)} | доход ${money(x.income)}/12ч`).join('\n');
  const h = houses.map(x => `${x.id}. ${x.title} — ${money(x.price)}`).join('\n');
  const c = cars.map(x => `${x.id}. ${x.title} — ${money(x.price)}`).join('\n');
  await ctx.reply(`🛒 Магазин ${BOT_NAME}

🏢 Бизнесы:
${b}

🏠 Дома:
${h}

🚗 Машины:
${c}

Команды:
купить бизнес 1
купить дом 1
купить машина 1`);
});

async function buyItem(ctx, type, list, id) {
  const user = await requireUser(ctx);
  const item = list.find(x => x.id === Number(id));
  if (!item) return ctx.reply('❌ Такого товара нет. Открой магазин.');
  if (Number(user.foxes) < item.price) return ctx.reply(`❌ Не хватает Фоксов. Нужно: ${money(item.price)}`);
  await pool.query('UPDATE users SET foxes=foxes-$1 WHERE id=$2', [item.price, user.id]);
  await pool.query('INSERT INTO inventory (user_id, item_type, item_id, title, income) VALUES ($1,$2,$3,$4,$5)', [user.id, type, item.id, item.title, item.income || 0]);
  await logTx(user.id, `buy_${type}`, -item.price, item.title);
  await ctx.reply(`✅ Куплено: ${item.title}
Цена: ${money(item.price)}`);
}

bot.hears(/^купить\s+бизнес\s+(\d+)$/i, async (ctx) => buyItem(ctx, 'business', businesses, ctx.match[1]));
bot.hears(/^купить\s+дом\s+(\d+)$/i, async (ctx) => buyItem(ctx, 'house', houses, ctx.match[1]));
bot.hears(/^купить\s+(машина|тачка)\s+(\d+)$/i, async (ctx) => buyItem(ctx, 'car', cars, ctx.match[2]));

bot.hears(/^бизнес$/i, async (ctx) => {
  const user = await requireUser(ctx);
  const r = await pool.query('SELECT title, income FROM inventory WHERE user_id=$1 AND item_type=$2', [user.id, 'business']);
  if (!r.rows.length) return ctx.reply('🏢 У тебя пока нет бизнесов. Пиши: магазин');
  const total = r.rows.reduce((s, x) => s + Number(x.income), 0);
  await ctx.reply(`🏢 Твои бизнесы:

${r.rows.map((x, i) => `${i + 1}. ${x.title} — ${money(x.income)}/12ч`).join('\n')}

Общий доход: ${money(total)}/12ч
Команда: собрать`);
});

bot.hears(/^собрать$/i, async (ctx) => {
  const user = await requireUser(ctx);
  const last = user.last_collect_at ? new Date(user.last_collect_at).getTime() : 0;
  const now = Date.now();
  if (last && now - last < 12 * 60 * 60 * 1000) return ctx.reply('⏳ Доход с бизнесов можно собирать раз в 12 часов.');
  const r = await pool.query('SELECT COALESCE(SUM(income),0) total FROM inventory WHERE user_id=$1 AND item_type=$2', [user.id, 'business']);
  const total = Number(r.rows[0].total || 0);
  if (!total) return ctx.reply('🏢 У тебя нет бизнесов для сбора дохода.');
  await pool.query('UPDATE users SET foxes=foxes+$1, last_collect_at=NOW() WHERE id=$2', [total, user.id]);
  await logTx(user.id, 'business_collect', total);
  await ctx.reply(`💼 Доход собран: +${money(total)}`);
});

bot.hears(/^передать\s+(@\w+)\s+(.+)$/i, async (ctx) => {
  const user = await requireUser(ctx);
  const target = await findUserByMention(ctx.match[1]);
  const amount = parseAmount(ctx.match[2], user);
  if (!target) return ctx.reply('❌ Этот игрок еще не запускал бота или у него нет username.');
  if (target.id === user.id) return ctx.reply('❌ Себе переводить нельзя. Хотя попытка уверенная.');
  if (!amount || amount < 100) return ctx.reply('❌ Минимальный перевод: 100 Фоксов.');
  if (amount > Number(user.foxes)) return ctx.reply('❌ Недостаточно Фоксов.');
  await pool.query('BEGIN');
  try {
    await pool.query('UPDATE users SET foxes=foxes-$1 WHERE id=$2', [amount, user.id]);
    await pool.query('UPDATE users SET foxes=foxes+$1 WHERE id=$2', [amount, target.id]);
    await pool.query('COMMIT');
    await ctx.reply(`✅ Перевод выполнен: @${target.username} получил ${money(amount)}`);
  } catch (e) { await pool.query('ROLLBACK'); throw e; }
});

bot.hears(/^промо\s+(.+)$/i, async (ctx) => {
  const user = await requireUser(ctx);
  const code = ctx.match[1].trim().replace('#', '');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const promoRes = await client.query('SELECT * FROM promo_codes WHERE LOWER(code)=LOWER($1) FOR UPDATE', [code]);
    const promo = promoRes.rows[0];
    if (!promo) { await client.query('ROLLBACK'); return ctx.reply('❌ Такого промокода нет.'); }
    if (Number(promo.activations) >= Number(promo.max_activations)) { await client.query('ROLLBACK'); return ctx.reply('😢 Активации промокода закончились.'); }
    const used = await client.query('SELECT id FROM promo_activations WHERE promo_id=$1 AND user_id=$2', [promo.id, user.id]);
    if (used.rows.length) { await client.query('ROLLBACK'); return ctx.reply('⚠️ Ты уже активировал этот промокод.'); }
    await client.query('INSERT INTO promo_activations (promo_id,user_id) VALUES ($1,$2)', [promo.id, user.id]);
    await client.query('UPDATE promo_codes SET activations=activations+1 WHERE id=$1', [promo.id]);
    await client.query('UPDATE users SET foxes=foxes+$1, crystals=crystals+$2 WHERE id=$3', [promo.reward_foxes, promo.reward_crystals, user.id]);
    await client.query('COMMIT');
    await ctx.reply(`✅ Промокод активирован!

+${money(promo.reward_foxes)}
+${gems(promo.reward_crystals)}

Осталось активаций: ${Number(promo.max_activations) - Number(promo.activations) - 1}`);
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
});

bot.hears(/^топ$/i, async (ctx) => {
  await requireUser(ctx);
  const r = await pool.query('SELECT username, first_name, foxes, bank FROM users ORDER BY (foxes + bank) DESC LIMIT 10');
  const text = r.rows.map((u, i) => `${i + 1}. ${u.username ? '@' + u.username : u.first_name || 'Игрок'} — ${money(Number(u.foxes) + Number(u.bank))}`).join('\n');
  await ctx.reply(`🏆 Топ богачей:

${text || 'Пока пусто.'}`);
});

bot.hears(/^реф$/i, async (ctx) => {
  const user = await requireUser(ctx);
  const botUsername = process.env.BOT_USERNAME || 'YOUR_BOT_USERNAME';
  const r = await pool.query('SELECT COUNT(*) c FROM users WHERE referrer_id=$1', [user.id]);
  await ctx.reply(`👥 Рефералка

За каждого друга: 15 000 Фоксов + 5 Кристаллов.
Приглашено: ${r.rows[0].c}

https://t.me/${botUsername}?start=ref_${ctx.from.id}`);
});

bot.hears(/^клан$/i, async (ctx) => {
  const user = await requireUser(ctx);
  const r = await pool.query('SELECT c.*, cm.role FROM clans c JOIN clan_members cm ON cm.clan_id=c.id WHERE cm.user_id=$1', [user.id]);
  if (!r.rows.length) return ctx.reply(`🛡 У тебя нет клана.

Команды:
клан создать Название
клан вступить ID
топ кланы`);
  const c = r.rows[0];
  const count = await pool.query('SELECT COUNT(*) c FROM clan_members WHERE clan_id=$1', [c.id]);
  await ctx.reply(`🛡 Клан #${c.id}: ${c.title}
Роль: ${c.role}
Участников: ${count.rows[0].c}
Казна: ${money(c.bank)}
XP: ${c.xp}

Команда: клан донат 1000`);
});

bot.hears(/^клан\s+создать\s+(.{3,32})$/i, async (ctx) => {
  const user = await requireUser(ctx);
  const title = ctx.match[1].trim();
  const exists = await pool.query('SELECT id FROM clan_members WHERE user_id=$1', [user.id]);
  if (exists.rows.length) return ctx.reply('❌ Ты уже в клане.');
  if (Number(user.foxes) < 250000) return ctx.reply(`❌ Создание клана стоит ${money(250000)}.`);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE users SET foxes=foxes-250000 WHERE id=$1', [user.id]);
    const c = await client.query('INSERT INTO clans (title, owner_user_id) VALUES ($1,$2) RETURNING *', [title, user.id]);
    await client.query('INSERT INTO clan_members (clan_id,user_id,role) VALUES ($1,$2,$3)', [c.rows[0].id, user.id, 'owner']);
    await client.query('COMMIT');
    await ctx.reply(`🛡 Клан создан!

#${c.rows[0].id} ${title}`);
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
});

bot.hears(/^клан\s+вступить\s+(\d+)$/i, async (ctx) => {
  const user = await requireUser(ctx);
  const exists = await pool.query('SELECT id FROM clan_members WHERE user_id=$1', [user.id]);
  if (exists.rows.length) return ctx.reply('❌ Ты уже в клане.');
  const c = await pool.query('SELECT * FROM clans WHERE id=$1', [Number(ctx.match[1])]);
  if (!c.rows.length) return ctx.reply('❌ Клан не найден.');
  await pool.query('INSERT INTO clan_members (clan_id,user_id) VALUES ($1,$2)', [c.rows[0].id, user.id]);
  await ctx.reply(`✅ Ты вступил в клан: ${c.rows[0].title}`);
});

bot.hears(/^клан\s+донат\s+(.+)$/i, async (ctx) => {
  const user = await requireUser(ctx);
  const amount = parseAmount(ctx.match[1], user);
  if (!amount || amount < 1000) return ctx.reply('❌ Минимальный донат в клан: 1000 Фоксов.');
  if (amount > Number(user.foxes)) return ctx.reply('❌ Недостаточно Фоксов.');
  const m = await pool.query('SELECT clan_id FROM clan_members WHERE user_id=$1', [user.id]);
  if (!m.rows.length) return ctx.reply('❌ Ты не в клане.');
  await pool.query('UPDATE users SET foxes=foxes-$1 WHERE id=$2', [amount, user.id]);
  await pool.query('UPDATE clans SET bank=bank+$1, xp=xp+$2 WHERE id=$3', [amount, Math.floor(amount / 1000), m.rows[0].clan_id]);
  await ctx.reply(`🛡 В казну клана отправлено: ${money(amount)}`);
});

bot.hears(/^топ\s+кланы$/i, async (ctx) => {
  await requireUser(ctx);
  const r = await pool.query('SELECT id,title,bank,xp FROM clans ORDER BY (bank + xp * 1000) DESC LIMIT 10');
  const text = r.rows.map((c, i) => `${i + 1}. #${c.id} ${c.title} — казна ${money(c.bank)}, XP ${c.xp}`).join('\n');
  await ctx.reply(`🛡 Топ кланов:

${text || 'Кланов пока нет.'}`);
});

bot.command('adm_stats', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const u = await pool.query('SELECT COUNT(*) c, COALESCE(SUM(foxes),0) s FROM users');
  const c = await pool.query('SELECT COUNT(*) c FROM clans');
  await ctx.reply(`📊 Статистика

Игроков: ${u.rows[0].c}
Фоксов на руках: ${money(u.rows[0].s)}
Кланов: ${c.rows[0].c}`);
});

bot.command('adm_promo', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const parts = ctx.message.text.split(/\s+/);
  const [, code, foxes, crystals, max] = parts;
  if (!code || !foxes || !crystals || !max) return ctx.reply('/adm_promo CODE FOXES CRYSTALS MAX');
  await pool.query(`INSERT INTO promo_codes (code,reward_foxes,reward_crystals,max_activations) VALUES ($1,$2,$3,$4)
    ON CONFLICT (code) DO UPDATE SET reward_foxes=$2,reward_crystals=$3,max_activations=$4`, [code, Number(foxes), Number(crystals), Number(max)]);
  await ctx.reply(`✅ Промо создан/обновлен: ${code}`);
});

bot.command('adm_give', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const parts = ctx.message.text.split(/\s+/);
  const [, mention, amountRaw] = parts;
  const amount = Number(amountRaw);
  if (!mention || !amount) return ctx.reply('/adm_give @username 100000');
  const target = await findUserByMention(mention);
  if (!target) return ctx.reply('Игрок не найден.');
  await pool.query('UPDATE users SET foxes=foxes+$1 WHERE id=$2', [amount, target.id]);
  await ctx.reply(`✅ Выдано @${target.username}: ${money(amount)}`);
});

bot.command('adm_give_id', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const parts = ctx.message.text.split(/\s+/);
  const [, tgId, amountRaw] = parts;
  const amount = Number(amountRaw);
  if (!tgId || !amount) return ctx.reply('/adm_give_id 123456789 100000');
  await pool.query('UPDATE users SET foxes=foxes+$1 WHERE tg_id=$2', [amount, Number(tgId)]);
  await ctx.reply(`✅ Выдано tg_id ${tgId}: ${money(amount)}`);
});

bot.catch((err, ctx) => {
  console.error('Bot error:', err);
  ctx.reply('⚠️ Ошибка. Попробуй еще раз или напиши админу.').catch(() => {});
});

await initDb();
bot.launch();
console.log(`${BOT_NAME} started`);
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
