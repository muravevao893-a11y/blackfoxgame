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

const caseTypes = [
  { id: 1, title: 'Лисий кейс', price: 25000, minFoxes: 15000, maxFoxes: 90000, crystalChance: 0.08, jackpotChance: 0.015 },
  { id: 2, title: 'Неоновый кейс', price: 120000, minFoxes: 90000, maxFoxes: 380000, crystalChance: 0.18, jackpotChance: 0.035 },
  { id: 3, title: 'Королевский кейс', price: 600000, minFoxes: 450000, maxFoxes: 1800000, crystalChance: 0.35, jackpotChance: 0.06 },
  { id: 4, title: 'BFG-style кейс', price: 2500000, minFoxes: 1500000, maxFoxes: 8500000, crystalChance: 0.55, jackpotChance: 0.09 }
];

const facilityTypes = {
  business: { title: 'Бизнес', aliases: ['бизнес', 'мой бизнес'], build: 'построить бизнес', price: 350000, income: 65000, intervalHours: 6, icon: '🗄' },
  generator: { title: 'Генератор', aliases: ['генератор', 'мой генератор'], build: 'построить генератор', price: 750000, income: 145000, intervalHours: 6, icon: '🏭' },
  farm: { title: 'Майнинг ферма', aliases: ['ферма', 'моя ферма'], build: 'построить ферму', price: 1400000, income: 310000, intervalHours: 8, icon: '🧰' },
  quarry: { title: 'Карьер', aliases: ['карьер', 'мой карьер'], build: 'построить карьер', price: 2800000, income: 720000, intervalHours: 10, icon: '⚠️' },
  tree: { title: 'Денежное дерево', aliases: ['денежное дерево', 'моё дерево', 'мое дерево'], build: 'построить участок', price: 500000, income: 90000, intervalHours: 4, icon: '🏡' },
  garden: { title: 'Сад', aliases: ['сад', 'мой сад'], build: 'построить сад', price: 900000, income: 120000, intervalHours: 6, icon: '🌳' }
};

const magicBallAnswers = [
  'да, но лучше без резких движений', 'нет, вселенная орет «не сегодня»', 'шансы хорошие',
  'ответ где-то рядом, но он в отпуске', '100%, если не забьешь', 'сомнительно, но красиво',
  'да, лис подтверждает', 'лучше спроси позже', 'нет, но можно переиграть', 'возможно, если повезет'
];

const potionTypes = [
  { id: 1, title: 'Зелье удачи', cost: 3, effect: 'case_luck', description: 'повышает шанс джекпота в кейсах на 2 часа' },
  { id: 2, title: 'Зелье дохода', cost: 5, effect: 'income_boost', description: 'дает +25% к пассивному доходу на 2 часа' },
  { id: 3, title: 'Зелье азарта', cost: 7, effect: 'luck_potions', description: 'выдает 3 заряда для команды «испытать удачу»' }
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

async function findUserByTgId(tgId) {
  const r = await pool.query('SELECT * FROM users WHERE tg_id = $1', [Number(tgId)]);
  return r.rows[0];
}
function nowPlusHours(hours) {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}
function normalizeRu(text) {
  return String(text || '').trim().toLowerCase().replaceAll('ё', 'е');
}
function formatDuration(ms) {
  const totalMin = Math.max(1, Math.ceil(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h ? `${h}ч ${m}м` : `${m}м`;
}
async function ensureFacility(user, kind) {
  const cfg = facilityTypes[kind];
  const r = await pool.query('SELECT * FROM facilities WHERE user_id=$1 AND kind=$2', [user.id, kind]);
  return { cfg, facility: r.rows[0] };
}
async function collectFacilityIncome(user, kind) {
  const { cfg, facility } = await ensureFacility(user, kind);
  if (!facility) return { cfg, facility: null, collected: 0, waitMs: 0 };
  const last = facility.last_collect_at ? new Date(facility.last_collect_at).getTime() : new Date(facility.created_at).getTime();
  const intervalMs = cfg.intervalHours * 60 * 60 * 1000;
  const passed = Date.now() - last;
  if (passed < intervalMs) return { cfg, facility, collected: 0, waitMs: intervalMs - passed };
  const boostActive = user.income_boost_until && new Date(user.income_boost_until).getTime() > Date.now();
  const income = Math.floor(Number(facility.income) * (boostActive ? 1.25 : 1));
  await pool.query('UPDATE users SET foxes=foxes+$1 WHERE id=$2', [income, user.id]);
  await pool.query('UPDATE facilities SET last_collect_at=NOW() WHERE id=$1', [facility.id]);
  await logTx(user.id, `${kind}_collect`, income);
  return { cfg, facility, collected: income, waitMs: 0 };
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

🎲 Бурмалденс-развлекуха:
шар фраза
выбери фраза или фраза2
инфа фраза
испытать удачу

💒 Браки:
свадьба ID_пользователя
развод
мой брак

📦 Кейсы:
кейсы
купить кейс номер количество
открыть кейс номер количество

🎰 Игры:
казино сумма / казино все / казино половина
монетка сумма орел/решка
кубик сумма

🏦 Экономика:
банк
банк положить сумма
банк снять сумма
магазин

🗄 Пассивный доход:
бизнес / мой бизнес / построить бизнес
генератор / мой генератор / построить генератор
ферма / моя ферма / построить ферму
карьер / мой карьер / построить карьер
денежное дерево / моё дерево / построить участок
сад / мой сад / построить сад
сад полить
зелья
создать зелье номер

🛡 Кланы:
клан
клан создать Название
клан вступить ID
клан донат сумма
топ кланы

🏆 Рейтинги:
топ
промо КОД

Важно: это виртуальная игра без вывода денег.`
bot.start(async (ctx) => {
  const user = await requireUser(ctx);
  await ctx.reply(`🦊 Добро пожаловать в ${BOT_NAME}!

Тебе начислено: ${money(user.foxes)}
Пиши: помощь`);
});

bot.hears(/^(помощь|help|меню)$/i, async (ctx) => { await requireUser(ctx); await ctx.reply(helpText); });

// ===== Burmaldance entertainment pack =====
bot.hears(/^шар\s+(.{1,300})$/i, async (ctx) => {
  await requireUser(ctx);
  const q = ctx.match[1].trim();
  const answer = magicBallAnswers[randInt(0, magicBallAnswers.length - 1)];
  await ctx.reply(`🔮 Шар думает над: «${q}»\n\nОтвет: ${answer}.`);
});

bot.hears(/^выбери\s+(.+)\s+или\s+(.+)$/i, async (ctx) => {
  await requireUser(ctx);
  const a = ctx.match[1].trim();
  const b = ctx.match[2].trim();
  const choice = Math.random() < 0.5 ? a : b;
  await ctx.reply(`💬 Я выбираю: ${choice}`);
});

bot.hears(/^инфа\s+(.{1,300})$/i, async (ctx) => {
  await requireUser(ctx);
  const percent = randInt(0, 100);
  await ctx.reply(`📊 Инфа по «${ctx.match[1].trim()}»: ${percent}%`);
});

bot.hears(/^испытать\s+удачу$/i, async (ctx) => {
  const user = await requireUser(ctx);
  const now = Date.now();
  const last = user.last_luck_at ? new Date(user.last_luck_at).getTime() : 0;
  const hasPotion = Number(user.luck_potions || 0) > 0;
  if (!hasPotion && last && now - last < 60 * 60 * 1000) {
    return ctx.reply(`🍀 Удачу можно испытывать раз в час. Осталось: ${formatDuration(60 * 60 * 1000 - (now - last))}`);
  }
  const r = Math.random();
  let reward = 0;
  let crystals = 0;
  let text = 'обычная удача';
  if (r < 0.05) { reward = randInt(250000, 900000); crystals = randInt(1, 5); text = 'джекпот удачи'; }
  else if (r < 0.35) { reward = randInt(50000, 180000); text = 'хороший занос'; }
  else if (r < 0.75) { reward = randInt(5000, 35000); text = 'маленький плюс'; }
  else { reward = -randInt(3000, 25000); text = 'удача решила пошутить'; }
  const potionSql = hasPotion ? ', luck_potions = luck_potions - 1' : ', last_luck_at = NOW()';
  await pool.query(`UPDATE users SET foxes = GREATEST(0, foxes + $1), crystals = crystals + $2 ${potionSql} WHERE id=$3`, [reward, crystals, user.id]);
  await logTx(user.id, 'luck_test', reward, text);
  await ctx.reply(`🍀 Испытание удачи: ${text}\n\n${reward >= 0 ? '+' : '-'}${money(Math.abs(reward))}${crystals ? `\n+${gems(crystals)}` : ''}${hasPotion ? '\n\n🧪 Потрачен заряд зелья азарта.' : ''}`);
});

// ===== Marriages =====
bot.hears(/^свадьба\s+(\d+)$/i, async (ctx) => {
  const user = await requireUser(ctx);
  const target = await findUserByTgId(ctx.match[1]);
  if (!target) return ctx.reply('💔 Игрок не найден. Он должен хотя бы раз запустить бота.');
  if (target.id === user.id) return ctx.reply('💔 Сам с собой? Лис такое не регистрирует.');
  const busy = await pool.query('SELECT id FROM marriages WHERE user1_id IN ($1,$2) OR user2_id IN ($1,$2)', [user.id, target.id]);
  if (busy.rows.length) return ctx.reply('💔 Кто-то из вас уже состоит в браке. Сначала развод.');
  const price = 100000;
  if (Number(user.foxes) < price) return ctx.reply(`💒 Свадьба стоит ${money(price)}.`);
  await pool.query('UPDATE users SET foxes=foxes-$1 WHERE id=$2', [price, user.id]);
  await pool.query('INSERT INTO marriages (user1_id, user2_id) VALUES ($1,$2)', [user.id, target.id]);
  await logTx(user.id, 'marriage', -price, String(target.tg_id));
  await ctx.reply(`💖 Свадьба состоялась!\n\n${ctx.from.first_name} теперь в браке с ${target.first_name || target.username || target.tg_id}.`);
});

bot.hears(/^развод$/i, async (ctx) => {
  const user = await requireUser(ctx);
  const r = await pool.query('DELETE FROM marriages WHERE user1_id=$1 OR user2_id=$1 RETURNING *', [user.id]);
  if (!r.rows.length) return ctx.reply('💌 У тебя нет брака. Разводиться не с кем.');
  await ctx.reply('💔 Развод оформлен. Свобода, но с привкусом грусти.');
});

bot.hears(/^(мой\s+брак|моя\s+свадьба)$/i, async (ctx) => {
  const user = await requireUser(ctx);
  const r = await pool.query(`SELECT m.*, u1.first_name a_name, u1.username a_user, u1.tg_id a_tg, u2.first_name b_name, u2.username b_user, u2.tg_id b_tg
    FROM marriages m JOIN users u1 ON u1.id=m.user1_id JOIN users u2 ON u2.id=m.user2_id
    WHERE m.user1_id=$1 OR m.user2_id=$1`, [user.id]);
  if (!r.rows.length) return ctx.reply('💌 Ты пока не в браке. Команда: свадьба ID');
  const m = r.rows[0];
  const partner = m.user1_id === user.id ? { name: m.b_name, username: m.b_user, tg: m.b_tg } : { name: m.a_name, username: m.a_user, tg: m.a_tg };
  await ctx.reply(`💌 Твой брак\n\nПартнер: ${partner.username ? '@' + partner.username : partner.name || partner.tg}\nДата: ${new Date(m.created_at).toLocaleString('ru-RU')}`);
});

// ===== Multi-case system =====
bot.hears(/^кейсы$/i, async (ctx) => {
  const user = await requireUser(ctx);
  const inv = await pool.query('SELECT case_id, amount FROM user_cases WHERE user_id=$1 AND amount>0', [user.id]);
  const owned = Object.fromEntries(inv.rows.map(x => [x.case_id, x.amount]));
  const list = caseTypes.map(c => `${c.id}. ${c.title} — ${money(c.price)} | у тебя: ${owned[c.id] || 0}`).join('\n');
  await ctx.reply(`📦 Кейсы\n\n${list}\n\nКоманды:\nкупить кейс 1 5\nоткрыть кейс 1 5`);
});

bot.hears(/^купить\s+кейс\s+(\d+)\s*(\d+)?$/i, async (ctx) => {
  const user = await requireUser(ctx);
  const caseId = Number(ctx.match[1]);
  const amount = Math.min(100, Math.max(1, Number(ctx.match[2] || 1)));
  const c = caseTypes.find(x => x.id === caseId);
  if (!c) return ctx.reply('❌ Такого кейса нет. Пиши: кейсы');
  const total = c.price * amount;
  if (Number(user.foxes) < total) return ctx.reply(`❌ Не хватает ${CURRENCY}. Нужно: ${money(total)}`);
  await pool.query('UPDATE users SET foxes=foxes-$1 WHERE id=$2', [total, user.id]);
  await pool.query(`INSERT INTO user_cases (user_id, case_id, amount) VALUES ($1,$2,$3)
    ON CONFLICT (user_id, case_id) DO UPDATE SET amount=user_cases.amount+$3`, [user.id, c.id, amount]);
  await ctx.reply(`🛒 Куплено: ${c.title} x${amount}\nЦена: ${money(total)}`);
});

bot.hears(/^открыть\s+кейс\s+(\d+)\s*(\d+)?$/i, async (ctx) => {
  const user = await requireUser(ctx);
  const caseId = Number(ctx.match[1]);
  const amount = Math.min(50, Math.max(1, Number(ctx.match[2] || 1)));
  const c = caseTypes.find(x => x.id === caseId);
  if (!c) return ctx.reply('❌ Такого кейса нет. Пиши: кейсы');
  const own = await pool.query('SELECT amount FROM user_cases WHERE user_id=$1 AND case_id=$2', [user.id, caseId]);
  if (!own.rows.length || Number(own.rows[0].amount) < amount) return ctx.reply(`❌ У тебя нет столько кейсов. Пиши: кейсы`);
  const lucky = user.case_luck_until && new Date(user.case_luck_until).getTime() > Date.now();
  let totalFoxes = 0;
  let totalCrystals = 0;
  let jackpots = 0;
  for (let i = 0; i < amount; i++) {
    const jackpotChance = c.jackpotChance + (lucky ? 0.04 : 0);
    if (Math.random() < jackpotChance) {
      jackpots++;
      totalFoxes += randInt(c.maxFoxes, c.maxFoxes * 4);
      totalCrystals += randInt(2, 12);
    } else {
      totalFoxes += randInt(c.minFoxes, c.maxFoxes);
      if (Math.random() < c.crystalChance) totalCrystals += randInt(1, 4);
    }
  }
  await pool.query('UPDATE user_cases SET amount=amount-$1 WHERE user_id=$2 AND case_id=$3', [amount, user.id, caseId]);
  await pool.query('UPDATE users SET foxes=foxes+$1, crystals=crystals+$2 WHERE id=$3', [totalFoxes, totalCrystals, user.id]);
  await logTx(user.id, 'open_cases', totalFoxes, `${c.title} x${amount}`);
  await ctx.reply(`🔐 Открыто: ${c.title} x${amount}\n\n+${money(totalFoxes)}\n+${gems(totalCrystals)}${jackpots ? `\n\n💥 Джекпотов: ${jackpots}` : ''}${lucky ? '\n🧪 Работало зелье удачи.' : ''}`);
});

// ===== Passive buildings =====
bot.hears(/^(построить\s+бизнес|построить\s+генератор|построить\s+ферму|построить\s+карьер|построить\s+участок|построить\s+сад)$/i, async (ctx) => {
  const user = await requireUser(ctx);
  const cmd = normalizeRu(ctx.match[1]);
  const entry = Object.entries(facilityTypes).find(([, cfg]) => normalizeRu(cfg.build) === cmd);
  if (!entry) return;
  const [kind, cfg] = entry;
  const exists = await pool.query('SELECT id FROM facilities WHERE user_id=$1 AND kind=$2', [user.id, kind]);
  if (exists.rows.length) return ctx.reply(`${cfg.icon} У тебя уже построен ${cfg.title}. Пиши: ${cfg.aliases[0]}`);
  if (Number(user.foxes) < cfg.price) return ctx.reply(`❌ Не хватает ${CURRENCY}. Постройка стоит ${money(cfg.price)}.`);
  await pool.query('UPDATE users SET foxes=foxes-$1 WHERE id=$2', [cfg.price, user.id]);
  await pool.query('INSERT INTO facilities (user_id, kind, title, income, last_collect_at) VALUES ($1,$2,$3,$4,NOW())', [user.id, kind, cfg.title, cfg.income]);
  await logTx(user.id, `build_${kind}`, -cfg.price, cfg.title);
  await ctx.reply(`${cfg.icon} Построено: ${cfg.title}\n\nЦена: ${money(cfg.price)}\nДоход: ${money(cfg.income)} раз в ${cfg.intervalHours}ч`);
});

bot.hears(/^(мой\s+бизнес|бизнес|мой\s+генератор|генератор|моя\s+ферма|ферма|мой\s+карьер|карьер|денежное\s+дерево|мое\s+дерево|моё\s+дерево|мой\s+сад|сад)$/i, async (ctx) => {
  const user = await requireUser(ctx);
  const text = normalizeRu(ctx.match[1]);
  const entry = Object.entries(facilityTypes).find(([, cfg]) => cfg.aliases.map(normalizeRu).includes(text));
  if (!entry) return;
  const [kind, cfg] = entry;
  const res = await collectFacilityIncome(user, kind);
  if (!res.facility) return ctx.reply(`${cfg.icon} ${cfg.title} еще не построен.\n\nКоманда: ${cfg.build}\nЦена: ${money(cfg.price)}\nДоход: ${money(cfg.income)} раз в ${cfg.intervalHours}ч`);
  await ctx.reply(`${cfg.icon} ${cfg.title}\n\nУровень: ${res.facility.level}\nДоход: ${money(res.facility.income)} раз в ${cfg.intervalHours}ч\n${res.collected ? `\n💰 Собрано: +${money(res.collected)}` : `\n⏳ Следующий сбор через: ${formatDuration(res.waitMs)}`}`);
});

bot.hears(/^продать\s+(бизнес|генератор|ферму|ферма|карьер|участок|сад)$/i, async (ctx) => {
  await requireUser(ctx);
  await ctx.reply('💰 Продажа временно недоступна. Позже можно будет включить выкуп за часть цены.');
});

// ===== Garden and potions =====
bot.hears(/^сад\s+полить$/i, async (ctx) => {
  const user = await requireUser(ctx);
  const { facility } = await ensureFacility(user, 'garden');
  if (!facility) return ctx.reply('🌳 Сначала построй сад: построить сад');
  const last = user.garden_watered_at ? new Date(user.garden_watered_at).getTime() : 0;
  if (last && Date.now() - last < 3 * 60 * 60 * 1000) return ctx.reply(`💦 Сад уже полит. Следующий полив через ${formatDuration(3 * 60 * 60 * 1000 - (Date.now() - last))}.`);
  const reward = randInt(1, 3);
  await pool.query('UPDATE users SET garden_watered_at=NOW(), crystals=crystals+$1 WHERE id=$2', [reward, user.id]);
  await ctx.reply(`💦 Сад полит. Цветочки довольны.\n\n+${gems(reward)} для зелий.`);
});

bot.hears(/^зелья$/i, async (ctx) => {
  const user = await requireUser(ctx);
  const list = potionTypes.map(p => `${p.id}. ${p.title} — ${p.cost} ${GEM}\n   ${p.description}`).join('\n');
  await ctx.reply(`🍸 Зелья\n\n${list}\n\nУ тебя: ${gems(user.crystals)}\nКоманда: создать зелье 1`);
});

bot.hears(/^создать\s+зелье\s+(\d+)$/i, async (ctx) => {
  const user = await requireUser(ctx);
  const potion = potionTypes.find(p => p.id === Number(ctx.match[1]));
  if (!potion) return ctx.reply('❌ Такого зелья нет. Пиши: зелья');
  const { facility } = await ensureFacility(user, 'garden');
  if (!facility) return ctx.reply('🌳 Для зелий нужен сад. Команда: построить сад');
  if (Number(user.crystals) < potion.cost) return ctx.reply(`❌ Нужно ${potion.cost} ${GEM}.`);
  if (potion.effect === 'case_luck') {
    await pool.query('UPDATE users SET crystals=crystals-$1, case_luck_until=$2 WHERE id=$3', [potion.cost, nowPlusHours(2), user.id]);
  } else if (potion.effect === 'income_boost') {
    await pool.query('UPDATE users SET crystals=crystals-$1, income_boost_until=$2 WHERE id=$3', [potion.cost, nowPlusHours(2), user.id]);
  } else {
    await pool.query('UPDATE users SET crystals=crystals-$1, luck_potions=luck_potions+3 WHERE id=$2', [potion.cost, user.id]);
  }
  await ctx.reply(`🔮 Создано: ${potion.title}\nЭффект: ${potion.description}`);
});


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
